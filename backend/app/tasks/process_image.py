"""ARQ task: process_image.

Receives a source URL, extracts metadata, downloads the image,
runs the processing pipeline (phash, thumbnails, S3 upload),
and creates/updates database records (Post + Tags).

Handles:
- Oversized files (HEAD check before download)
- Duplicate images (phash check)
- Download failures
- Tag creation and association
"""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_factory
from app.models.auto_rating_rule import AutoRatingRule
from app.models.post import Post, Rating, SourceSite
from app.models.post_tag import PostTag
from app.models.tag import Tag, TagCategory
from app.models.tag_alias import TagAlias
from app.services.pipeline import (
    DuplicateImageError,
    ImageTooLargeError,
    download_and_process,
)
from app.source_extractors import get_extractor

logger = logging.getLogger(__name__)

# ── URL pattern matchers (inlined from deleted source_resolver.py) ─────────

_PIXIV_PATTERNS = [
    re.compile(
        r"(?:https?://)?(?:www\.)?pixiv\.net/(?:artworks|illust)/(\d+)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:https?://)?(?:www\.)?pixiv\.net/member_illust\.php\?.*illust_id=(\d+)",
        re.IGNORECASE,
    ),
]

_TWITTER_PATTERNS = [
    re.compile(
        r"(?:https?://)?(?:www\.)?(?:twitter\.com|x\.com)/(\w+)/status/(\d+)",
        re.IGNORECASE,
    ),
]

_DANBOORU_PATTERNS = [
    re.compile(
        r"(?:https?://)?(?:danbooru\.donmai\.us|safebooru\.donmai\.us)/posts/(\d+)",
        re.IGNORECASE,
    ),
]


def _resolve_source_or_other(url: str) -> tuple[SourceSite, str]:
    """Resolve a URL to its source site and ID, falling back to 'other'."""
    parsed = urlparse(url)
    hostname = parsed.hostname or ""

    # Pixiv
    if "pixiv" in hostname:
        for pattern in _PIXIV_PATTERNS:
            match = pattern.search(url)
            if match:
                return SourceSite.pixiv, match.group(1)

    # Twitter / X
    if "twitter" in hostname or "x.com" in hostname:
        for pattern in _TWITTER_PATTERNS:
            match = pattern.search(url)
            if match:
                return SourceSite.twitter, match.group(2)

    # Danbooru / Safebooru
    if "donmai.us" in hostname:
        for pattern in _DANBOORU_PATTERNS:
            match = pattern.search(url)
            if match:
                return SourceSite.danbooru, match.group(1)

    # Fallback: use hostname + path as composite ID
    path_id = parsed.path.strip("/").replace("/", "_") or "unknown"
    return SourceSite.other, f"{hostname}_{path_id}"


async def process_image(ctx: dict[str, Any], source_url: str, source_site: str | None = None, source_id: str | None = None) -> dict[str, Any]:
    """ARQ task: process an image from a source URL.

    Steps:
    1. Resolve source site/ID from URL (if not provided)
    2. Use site-specific extractor to get metadata (title, tags, image URLs)
    3. Run image processing pipeline (HEAD check, download, phash, thumbnails, S3)
    4. Create Post record in database
    5. Create/update Tag records and associate with Post

    Args:
        ctx: ARQ context dict (contains Redis connection).
        source_url: The URL to process.
        source_site: Optional pre-resolved source site.
        source_id: Optional pre-resolved source ID.

    Returns:
        Dict with result status and post ID or error info.
    """
    logger.info("Processing image from URL: %s", source_url)

    async with async_session_factory() as db:
        try:
            # Step 1: Resolve source info if not provided
            if not source_site or not source_id:
                resolved_site, resolved_id = _resolve_source_or_other(source_url)
                source_site = resolved_site.value
                source_id = resolved_id

            # Step 2: Extract metadata via site-specific extractor
            extractor = get_extractor(source_url)
            try:
                metadata = await extractor.extract(source_url)
                title = metadata.title
                description = metadata.description
                tag_names = metadata.tags
                tag_categories = metadata.tag_categories
                post_rating = metadata.rating
                # Use extracted image URLs if available, otherwise use source URL
                image_urls = metadata.image_urls if metadata.image_urls else [source_url]
            except Exception as exc:
                logger.warning("Extractor failed for %s, using source URL directly: %s", source_url, exc)
                title = None
                description = None
                tag_names = []
                tag_categories = {}
                post_rating = Rating.safe
                image_urls = [source_url]

            # Step 3: Run image processing pipeline
            # Try each image URL until one succeeds
            source_site_enum = SourceSite(source_site)
            last_error = None
            result = None

            for img_url in image_urls:
                try:
                    # First URL: if extractor provided pre-downloaded bytes, pass them
                    img_bytes = metadata.image_bytes if (
                        img_url == image_urls[0] and metadata.image_bytes is not None
                    ) else None
                    result = await download_and_process(
                        url=img_url,
                        source_site=source_site_enum,
                        source_id=source_id,
                        db=db,
                        title=title,
                        description=description,
                        tag_names=tag_names,
                        tag_categories=tag_categories,
                        image_bytes=img_bytes,
                    )
                    break  # Success — stop trying URLs
                except ImageTooLargeError as exc:
                    logger.warning("Image too large (%s): %s", img_url, exc)
                    last_error = exc
                    # Don't try other URLs — they'll likely also be too large
                    return {
                        "status": "error",
                        "error": "image_too_large",
                        "message": str(exc),
                    }
                except DuplicateImageError as exc:
                    logger.warning("Duplicate image: %s", exc)
                    return {
                        "status": "error",
                        "error": "duplicate",
                        "existing_post_id": str(exc.existing_post_id),
                        "message": str(exc),
                    }
                except Exception as exc:
                    logger.warning("Download failed for %s: %s", img_url, exc)
                    last_error = exc
                    continue

            if result is None:
                error_msg = f"All download attempts failed for {source_url}"
                logger.error(error_msg)
                return {
                    "status": "error",
                    "error": "download_failed",
                    "message": error_msg,
                }

            # Step 4: Create Post record
            post = Post(
                s3_key=result.s3_key,
                thumb_key=result.thumb_key,
                preview_key=result.preview_key,
                source_url=source_url,
                source_site=source_site_enum,
                source_id=source_id,
                width=result.width,
                height=result.height,
                file_size=result.file_size,
                mime_type=result.mime_type,
                phash=result.phash,
                title=result.title,
                description=result.description,
                rating=post_rating,
            )
            db.add(post)

            # Step 5: Create/update Tags and associate with Post
            tags = await _ensure_tags(db, result.tag_names, result.tag_categories)

            # Step 5b: Check auto-rating rules
            if tag_names:
                rule_stmt = select(AutoRatingRule).where(
                    AutoRatingRule.tag_name.in_(
                        [n.strip().lower() for n in tag_names if n.strip()]
                    )
                )
                rule_result = await db.execute(rule_stmt)
                rules = rule_result.scalars().all()
                if rules:
                    _RATING_ORDER = {
                        Rating.safe: 0,
                        Rating.questionable: 1,
                        Rating.explicit: 2,
                    }
                    most_restrictive = max(
                        rules, key=lambda r: _RATING_ORDER[r.target_rating]
                    )
                    if _RATING_ORDER[most_restrictive.target_rating] > _RATING_ORDER.get(
                        post_rating, 0
                    ):
                        logger.info(
                            "Auto-rating override: %s -> %s (rule for tag '%s')",
                            post_rating,
                            most_restrictive.target_rating,
                            most_restrictive.tag_name,
                        )
                        post_rating = most_restrictive.target_rating
            for tag in tags:
                post_tag = PostTag(post_id=post.id, tag_id=tag.id)
                db.add(post_tag)

            await db.commit()

            logger.info("Successfully processed image: post %s", post.id)

            return {
                "status": "success",
                "post_id": str(post.id),
                "source_site": source_site,
                "source_id": source_id,
            }

        except Exception as exc:
            await db.rollback()
            logger.exception("Unexpected error processing %s: %s", source_url, exc)
            return {
                "status": "error",
                "error": "unexpected",
                "message": str(exc),
            }


async def _ensure_tags(
    db: AsyncSession, tag_names: list[str], tag_categories: dict[str, str]
) -> list[Tag]:
    """Ensure tags exist in the database, creating them if needed.

    Also resolves tag aliases and assigns categories from source metadata.

    Args:
        db: Async database session.
        tag_names: List of tag name strings to ensure exist.
        tag_categories: Dict mapping tag name → source category name
            (e.g. {"artist_name": "artist", "character_name": "character"}).

    Returns:
        List of Tag model instances.
    """
    tags = []

    for name in tag_names:
        name = name.strip().lower()
        if not name:
            continue

        # Resolve source category to our TagCategory
        source_cat = tag_categories.get(name, "")
        category = _resolve_tag_category(source_cat)

        # Check if this name is an alias for another tag
        alias_stmt = select(TagAlias).where(TagAlias.alias_name == name)
        alias_result = await db.execute(alias_stmt)
        alias = alias_result.scalar_one_or_none()

        if alias:
            # Use the canonical tag
            tag_stmt = select(Tag).where(Tag.id == alias.tag_id)
            tag_result = await db.execute(tag_stmt)
            tag = tag_result.scalar_one_or_none()
            if tag:
                tags.append(tag)
                continue

        # Look up or create the tag
        tag_stmt = select(Tag).where(Tag.name == name)
        tag_result = await db.execute(tag_stmt)
        tag = tag_result.scalar_one_or_none()

        if tag is None:
            tag = Tag(name=name, category=category, post_count=0)
            db.add(tag)
            # Flush to get the ID
            await db.flush()
        elif tag.category == TagCategory.general and category != TagCategory.general:
            # Upgrade existing 'general' tag to more specific category
            tag.category = category

        tags.append(tag)

    # Update post_count for all tags
    for tag in tags:
        tag.post_count += 1

    return tags


# ── Category mapping from gallery-dl / source names to our TagCategory ─────

# gallery-dl uses category names like "artist", "character", "copyright",
# "general", "meta" in its tag dict. We map these to our TagCategory enum.
# Some sources use different names (e.g. Pixiv uses Japanese or different keys),
# so we handle common variations.

_CATEGORY_MAP: dict[str, TagCategory] = {
    # Direct matches
    "artist": TagCategory.artist,
    "character": TagCategory.character,
    "copyright": TagCategory.copyright,
    "general": TagCategory.general,
    "meta": TagCategory.meta,
    # Pixiv variations (gallery-dl Pixiv extractor may use these)
    "creator": TagCategory.artist,
    "author": TagCategory.artist,
    "user": TagCategory.artist,
    "人物": TagCategory.character,
    "キャラクター": TagCategory.character,
    "作品": TagCategory.copyright,
    "コピーライト": TagCategory.copyright,
    # Danbooru / Gelbooru variations
    " Artists": TagCategory.artist,
    "Characters": TagCategory.character,
    "Copyrights": TagCategory.copyright,
    "General": TagCategory.general,
    "Meta": TagCategory.meta,
    # Twitter/X variations
    "hashtag": TagCategory.general,
    "mention": TagCategory.general,
}


def _resolve_tag_category(source_category: str) -> TagCategory:
    """Map a source category name to our TagCategory enum.

    Args:
        source_category: Category name from source metadata.

    Returns:
        TagCategory enum value, defaults to general if unknown.
    """
    source_lower = source_category.strip().lower()
    return _CATEGORY_MAP.get(source_lower, TagCategory.general)