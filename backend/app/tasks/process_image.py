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
from datetime import datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
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
from app.services.url_patterns import resolve_source_or_other
from app.source_extractors import get_extractor

logger = logging.getLogger(__name__)


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
            source_site_enum: SourceSite | None = None
            if not source_site or not source_id:
                resolved_site, resolved_id = resolve_source_or_other(source_url)
                source_site_enum = SourceSite(resolved_site)
                source_id = resolved_id
                source_site = resolved_site

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
                # Deduplicate image URLs (gallery-dl infojson branch may append duplicates)
                image_urls = list(dict.fromkeys(image_urls))
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
            if source_site_enum is None:
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

            # Step 5a: AI tag processing (classify + translate)
            try:
                await _ai_process_tags(db, tags)
            except Exception as exc:
                logger.warning("AI tag processing failed (non-blocking): %s", exc)

            # Step 5b: Check auto-rating rules
            auto_rating: Rating | None = None
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
                        auto_rating = most_restrictive.target_rating
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
                "auto_rating": auto_rating.value if auto_rating else None,
            }

        except Exception as exc:
            await db.rollback()
            logger.exception("Unexpected error processing %s: %s", source_url, exc)
            return {
                "status": "error",
                "error": "unexpected",
                "message": str(exc),
            }



async def _ai_process_tags(db: AsyncSession, tags: list[Tag]) -> None:
    """Run AI classification/translation on tags that haven't been processed yet.

    Looks up tag_knowledge cache first; falls back to AI API for uncached tags.
    Updates Tag records with category, danbooru_name, translation.
    Non-blocking: errors are logged but don't fail the parent task.
    """
    if not settings.ENABLE_AI_TAG_PROCESSING:
        return
    if not settings.AI_PROVIDER_API_KEY or not settings.AI_PROVIDER_ENDPOINT:
        return

    # Separate already-processed tags from unprocessed
    unprocessed = [t for t in tags if t.ai_processed_at is None]
    if not unprocessed:
        return

    # Check knowledge base cache
    from app.services.tag_knowledge import lookup_tags, batch_upsert_tag_knowledge

    tag_names = [t.name for t in unprocessed]
    cached = await lookup_tags(tag_names)

    # Apply cached results
    need_ai = []
    for tag in unprocessed:
        if tag.name in cached:
            entry = cached[tag.name]
            tag.category = TagCategory(entry.type)
            tag.danbooru_name = entry.danbooru_name
            tag.translation = entry.translation
            tag.ai_processed_at = datetime.utcnow()
        else:
            need_ai.append(tag)

    if not need_ai:
        await db.flush()
        return

    # Call AI for uncached tags
    from app.services.ai_tag import classify_tags

    ai_tag_names = [t.name for t in need_ai]
    try:
        results = await classify_tags(ai_tag_names)
    except Exception as exc:
        logger.warning("AI classification call failed: %s", exc)
        # Mark tags as attempted but failed
        for tag in need_ai:
            tag.ai_processed_at = None  # Leave unprocessed for retry
        return

    # Build lookup from AI results
    ai_lookup = {r["name"]: r for r in results}

    # Apply AI results to tags and write to knowledge base
    knowledge_entries = []
    for tag in need_ai:
        result = ai_lookup.get(tag.name)
        if result:
            tag.category = TagCategory(result["type"])
            tag.danbooru_name = result.get("danbooru_name")
            tag.translation = result.get("translation")
            tag.ai_processed_at = datetime.utcnow()

            knowledge_entries.append(
                {
                    "name": tag.name,
                    "type": result["type"],
                    "danbooru_name": result.get("danbooru_name"),
                    "translation": result.get("translation"),
                }
            )
        else:
            logger.warning("AI did not return result for tag '%s'", tag.name)

    # Batch write to knowledge base
    if knowledge_entries:
        await batch_upsert_tag_knowledge(knowledge_entries, source="ai")

    await db.flush()


async def reprocess_tags(ctx: dict[str, Any], force: bool = False) -> dict[str, Any]:
    """ARQ task: batch reprocess tags via AI.

    If force=True, reprocesses all tags. Otherwise only processes
    tags not yet in the knowledge base.

    Args:
        ctx: ARQ context dict.
        force: Whether to force reprocess all tags.

    Returns:
        Dict with processing stats.
    """
    from app.services.ai_tag import classify_tags
    from app.services.tag_knowledge import (
        batch_upsert_tag_knowledge,
        get_unprocessed_tag_names,
    )

    if not settings.ENABLE_AI_TAG_PROCESSING:
        return {"status": "skipped", "reason": "AI tag processing disabled"}

    if not settings.AI_PROVIDER_API_KEY or not settings.AI_PROVIDER_ENDPOINT:
        return {"status": "skipped", "reason": "AI provider not configured"}

    # Get tag names to process
    if force:
        async with async_session_factory() as db:
            result = await db.execute(select(Tag.name))
            tag_names = [row[0] for row in result.all()]
    else:
        tag_names = await get_unprocessed_tag_names()

    if not tag_names:
        return {"status": "success", "processed": 0, "reason": "no tags to process"}

    # Process in batches of 50 (API rate limit consideration)
    BATCH_SIZE = 50
    total_processed = 0
    total_errors = 0

    for i in range(0, len(tag_names), BATCH_SIZE):
        batch = tag_names[i : i + BATCH_SIZE]
        try:
            results = await classify_tags(batch)

            # Write to knowledge base
            knowledge_entries = [
                {
                    "name": r["name"],
                    "type": r["type"],
                    "danbooru_name": r.get("danbooru_name"),
                    "translation": r.get("translation"),
                }
                for r in results
            ]
            await batch_upsert_tag_knowledge(knowledge_entries, source="ai")

            # Update Tag records
            async with async_session_factory() as db:
                ai_lookup = {r["name"]: r for r in results}
                for tag_name in batch:
                    if tag_name in ai_lookup:
                        r = ai_lookup[tag_name]
                        stmt = (
                            update(Tag)
                            .where(Tag.name == tag_name)
                            .values(
                                category=TagCategory(r["type"]),
                                danbooru_name=r.get("danbooru_name"),
                                translation=r.get("translation"),
                                ai_processed_at=datetime.utcnow(),
                            )
                        )
                        await db.execute(stmt)
                await db.commit()

            total_processed += len(results)

        except Exception as exc:
            logger.exception("Batch reprocess failed for batch starting at %d: %s", i, exc)
            total_errors += len(batch)

    return {
        "status": "success",
        "total": len(tag_names),
        "processed": total_processed,
        "errors": total_errors,
    }


async def _ensure_tags(
    db: AsyncSession, tag_names: list[str], tag_categories: dict[str, str]
) -> list[Tag]:
    """Ensure tags exist in the database, creating them if needed.

    Batch-resolves aliases and existing tags to avoid N+1 queries.
    For N tags, issues at most 3 SELECTs + M INSERTs (M = new tags),
    instead of the previous N*2-3 SELECTs.
    """
    # Normalize and deduplicate
    normalized: list[str] = []
    seen: set[str] = set()
    for name in tag_names:
        name = name.strip().lower()
        if name and name not in seen:
            normalized.append(name)
            seen.add(name)

    if not normalized:
        return []

    # Step 1: Batch query all aliases WHERE alias_name IN (names)
    alias_stmt = select(TagAlias).where(TagAlias.alias_name.in_(normalized))
    alias_result = await db.execute(alias_stmt)
    aliases = alias_result.scalars().all()
    alias_map: dict[str, TagAlias] = {a.alias_name: a for a in aliases}

    # Names that are NOT aliases need direct tag lookup
    non_alias_names = [n for n in normalized if n not in alias_map]

    # Step 2: Batch query Tags WHERE name IN (non-alias names)
    tag_map: dict[str, Tag] = {}
    if non_alias_names:
        tag_stmt = select(Tag).where(Tag.name.in_(non_alias_names))
        tag_result = await db.execute(tag_stmt)
        for tag in tag_result.scalars().all():
            tag_map[tag.name] = tag

    # Step 3: Batch query canonical tags for aliases
    canonical_ids = list({a.tag_id for a in aliases})
    canonical_map: dict = {}
    if canonical_ids:
        canon_stmt = select(Tag).where(Tag.id.in_(canonical_ids))
        canon_result = await db.execute(canon_stmt)
        for tag in canon_result.scalars().all():
            canonical_map[tag.id] = tag

    # Step 4: Build result list, creating missing tags
    tags: list[Tag] = []
    for name in normalized:
        source_cat = tag_categories.get(name, "")
        category = _resolve_tag_category(source_cat)

        if name in alias_map:
            # Alias → resolve to canonical tag
            canonical = canonical_map.get(alias_map[name].tag_id)
            if canonical:
                tags.append(canonical)
                continue

        if name in tag_map:
            tag = tag_map[name]
            # Upgrade category if more specific
            if tag.category == TagCategory.general and category != TagCategory.general:
                tag.category = category
            tags.append(tag)
        else:
            # New tag — insert (may race with concurrent workers)
            tag = Tag(name=name, category=category, post_count=0)
            db.add(tag)
            try:
                await db.flush()
            except IntegrityError:
                # Concurrent worker created this tag — re-query
                await db.rollback()
                existing = await db.execute(
                    select(Tag).where(Tag.name == name)
                )
                tag = existing.scalar_one()
            tag_map[name] = tag
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