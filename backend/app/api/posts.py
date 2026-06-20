"""REST API routes for posts.

Provides paginated listing, single post detail, and random post endpoints.

Visibility: anonymous callers only ever see safe posts. An authenticated
admin session unlocks questionable/explicit posts across every endpoint here.
For single-post lookups, non-safe posts return 404 to anonymous callers so
that their existence is not leaked.
"""

from __future__ import annotations

import random
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.constants import ALLOWED_PER_PAGE
from app.auth import get_is_admin
from app.database import get_db
from app.models.post import Post, Rating, SourceSite
from app.schemas.post import PostListRead, PostRead, PostRatingUpdate

router = APIRouter()


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


@router.get("/random", response_model=PostRead)
async def random_post(
    db: AsyncSession = Depends(get_db),
    is_admin: bool = Depends(get_is_admin),
):
    """Return a single random post.

    Anonymous callers get a random safe post; admins may draw from all posts.
    """
    base = _apply_rating_filter(select(Post), is_admin)

    count_stmt = select(func.count()).select_from(base.subquery())
    count_result = await db.execute(count_stmt)
    total = count_result.scalar() or 0

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
    db: AsyncSession = Depends(get_db),
    is_admin: bool = Depends(get_is_admin),
):
    """Update a post's rating. Admin only.

    Used by the admin UI to flip a post between public (safe) and private
    (questionable/explicit).
    """
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")

    stmt = select(Post).where(Post.id == post_id)
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail=f"Post {post_id} not found")

    post.rating = body.rating
    await db.commit()
    await db.refresh(post)
    return post


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