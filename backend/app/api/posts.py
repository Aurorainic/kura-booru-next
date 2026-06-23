"""REST API routes for posts.

Provides paginated listing, single post detail, random post, and
delete endpoints.

Visibility: anonymous callers only ever see safe posts. An authenticated
admin session unlocks questionable/explicit posts across every endpoint here.
For single-post lookups, non-safe posts return 404 to anonymous callers so
that their existence is not leaked.

Delete: admin-only, removes post from DB (cascade to post_tags), deletes
S3 objects (original, thumb, preview), and decrements tag post_counts.
"""

from __future__ import annotations

import hmac
import logging
import random
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.constants import ALLOWED_PER_PAGE
from app.auth import get_current_admin, get_is_admin
from app.config import settings
from app.database import get_db
from app.models.admin import Admin
from app.models.post import Post, Rating, SourceSite
from app.models.post_tag import PostTag
from app.models.tag import Tag
from app.schemas.post import PostListRead, PostRead, PostRatingUpdate, PostTagsUpdate
from app.services.s3 import s3_service

router = APIRouter()

logger = logging.getLogger(__name__)


def _apply_rating_filter(stmt, is_admin: bool):
    """Restrict a SELECT to public (safe) posts for non-admin callers."""
    if not is_admin:
        stmt = stmt.where(Post.rating == Rating.safe)
    return stmt


@router.get("/", response_model=PostListRead)
async def list_posts(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    per_page: int = Query(40, description="Items per page (20, 40, or 100)"),
    rating: Rating | None = Query(
        None, description="Filter by rating (admin only; ignored for non-admins)"
    ),
    db: AsyncSession = Depends(get_db),
    is_admin: bool = Depends(get_is_admin),
):
    """Paginated list of posts, newest first.

    Anonymous callers always see only safe posts (like safebooru). Admins may
    additionally filter by rating via the `rating` query param.
    """
    # Validate per_page
    if per_page not in ALLOWED_PER_PAGE:
        per_page = 40

    # Base visibility filter
    base = select(Post)
    if is_admin:
        if rating is not None:
            base = base.where(Post.rating == rating)
    else:
        base = base.where(Post.rating == Rating.safe)

    # Total count
    count_stmt = select(func.count()).select_from(base.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Paginated query
    offset = (page - 1) * per_page
    stmt = base.order_by(Post.created_at.desc()).offset(offset).limit(per_page)
    result = await db.execute(stmt)
    posts = result.scalars().all()

    return PostListRead.from_page(
        items=posts,
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/by-source", response_model=PostRead)
async def get_post_by_source(
    source_site: str = Query(..., description="Source site (pixiv, twitter, danbooru, other)"),
    source_id: str = Query(..., description="Source site post ID"),
    db: AsyncSession = Depends(get_db),
    is_admin: bool = Depends(get_is_admin),
):
    """Look up a post by source site and source ID.

    Used by the Telegram bot to check if an image has already been saved.
    Non-safe posts are hidden from anonymous callers (404).
    """
    try:
        site_enum = SourceSite(source_site)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid source_site: {source_site}. "
            f"Valid values: {[s.value for s in SourceSite]}",
        )

    stmt = _apply_rating_filter(
        select(Post).where(
            Post.source_site == site_enum,
            Post.source_id == source_id,
        ),
        is_admin,
    )
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()

    if post is None:
        raise HTTPException(status_code=404, detail=f"Post from {source_site}:{source_id} not found")

    return post


# In-process count cache for random_post — avoids COUNT(*) on every request.
# ponytail: per-worker in-process cache, 5min TTL; good enough for random.
_random_post_count_cache: dict[bool, tuple[int, float]] = {}
_COUNT_CACHE_TTL = 300  # seconds


@router.get("/random", response_model=PostRead)
async def random_post(
    db: AsyncSession = Depends(get_db),
    is_admin: bool = Depends(get_is_admin),
):
    """Return a single random post.

    Anonymous callers get a random safe post; admins may draw from all posts.
    """
    base = _apply_rating_filter(select(Post), is_admin)

    # Use cached count if fresh
    now = time.monotonic()
    total = 0
    cached = _random_post_count_cache.get(is_admin)
    if cached and now - cached[1] < _COUNT_CACHE_TTL:
        total = cached[0]

    if total == 0:
        count_stmt = select(func.count()).select_from(base.subquery())
        count_result = await db.execute(count_stmt)
        total = count_result.scalar() or 0
        _random_post_count_cache[is_admin] = (total, now)

    if total == 0:
        raise HTTPException(status_code=404, detail="No posts found")

    # Random offset approach — efficient for large tables
    random_offset = random.randint(0, total - 1)
    stmt = base.order_by(Post.created_at.desc()).offset(random_offset).limit(1)
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()

    if post is None:
        raise HTTPException(status_code=404, detail="No posts found")

    return post


@router.patch("/{post_id}", response_model=PostRead)
async def update_post_rating(
    post_id: uuid.UUID,
    body: PostRatingUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    is_admin: bool = Depends(get_is_admin),
):
    """Update a post's rating. Admin session or API key required.

    Accepts either a valid admin session cookie (from web UI) or a valid
    X-Api-Key header (from the Telegram bot). If neither is present, returns 403.
    """
    if not is_admin:
        # Check API key as alternative auth
        x_api_key = request.headers.get("x-api-key")
        expected = settings.BACKEND_API_KEY
        if expected and x_api_key and hmac.compare_digest(x_api_key, expected):
            pass  # API key valid
        elif not expected:
            pass  # Dev mode: BACKEND_API_KEY not set, allow
        else:
            raise HTTPException(status_code=403, detail="Admin privileges or API key required")

    stmt = select(Post).where(Post.id == post_id)
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail=f"Post {post_id} not found")

    post.rating = body.rating
    await db.commit()
    await db.refresh(post)
    return post


@router.put("/{post_id}/tags", response_model=PostRead)
async def update_post_tags(
    post_id: uuid.UUID,
    body: PostTagsUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
):
    """Add or remove tags from a post. Admin only.

    - add_tags: list of tag names to add (created if they don't exist)
    - remove_tag_ids: list of tag IDs to remove
    """
    from app.models.tag import TagCategory

    stmt = select(Post).where(Post.id == post_id)
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail=f"Post {post_id} not found")

    # Remove tags
    for tag_id in body.remove_tag_ids:
        pt_stmt = select(PostTag).where(
            PostTag.post_id == post_id, PostTag.tag_id == tag_id
        )
        pt_result = await db.execute(pt_stmt)
        pt = pt_result.scalar_one_or_none()
        if pt:
            await db.delete(pt)
            # Decrement tag post_count
            tag_stmt = select(Tag).where(Tag.id == tag_id)
            tag_result = await db.execute(tag_stmt)
            tag = tag_result.scalar_one_or_none()
            if tag:
                tag.post_count = max(tag.post_count - 1, 0)

    # Add tags
    for tag_name in body.add_tags:
        name = tag_name.strip().lower()
        if not name:
            continue

        # Check if already associated
        existing_tag_stmt = select(Tag).where(Tag.name == name)
        existing_result = await db.execute(existing_tag_stmt)
        tag = existing_result.scalar_one_or_none()

        if tag is None:
            # Create the tag
            tag = Tag(name=name, category=TagCategory.general, post_count=0)
            db.add(tag)
            await db.flush()

        # Check if post already has this tag
        existing_pt_stmt = select(PostTag).where(
            PostTag.post_id == post_id, PostTag.tag_id == tag.id
        )
        existing_pt_result = await db.execute(existing_pt_stmt)
        if existing_pt_result.scalar_one_or_none() is None:
            pt = PostTag(post_id=post_id, tag_id=tag.id)
            db.add(pt)
            tag.post_count += 1

    await db.commit()
    await db.refresh(post)
    return post


@router.delete("/{post_id}", status_code=204)
async def delete_post(
    post_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    """Delete a post. Admin only.

    Removes the post from the database, deletes all S3 objects
    (original, thumb, preview), and decrements tag post_counts.
    S3 deletions are best-effort — failures are logged but do not
    prevent the DB record from being deleted.
    """
    stmt = select(Post).where(Post.id == post_id)
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail=f"Post {post_id} not found")

    # Step 1: Collect tag IDs for count decrement
    tag_stmt = select(PostTag.tag_id).where(PostTag.post_id == post_id)
    tag_result = await db.execute(tag_stmt)
    tag_ids = [row[0] for row in tag_result.all()]

    # Step 2: Delete S3 objects (best-effort)
    for key in (post.s3_key, post.thumb_key, post.preview_key):
        try:
            await s3_service.delete(key)
        except Exception as exc:
            logger.warning("Failed to delete S3 key %s: %s", key, exc)

    # Step 3: Delete the post (cascades to post_tags via ON DELETE CASCADE)
    await db.delete(post)

    # Step 4: Decrement tag post_counts (use GREATEST to avoid negative)
    if tag_ids:
        await db.execute(
            Tag.__table__.update()
            .where(Tag.id.in_(tag_ids))
            .values(post_count=func.greatest(Tag.post_count - 1, 0))
        )

    await db.commit()
    return None


@router.get("/{post_id}", response_model=PostRead)
async def get_post(
    post_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    is_admin: bool = Depends(get_is_admin),
):
    """Get a single post by ID, including its tags.

    Non-safe posts return 404 to anonymous callers (existence hidden).
    """
    stmt = _apply_rating_filter(select(Post).where(Post.id == post_id), is_admin)
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()

    if post is None:
        raise HTTPException(status_code=404, detail=f"Post {post_id} not found")

    return post
