"""REST API routes for posts.

Provides paginated listing, single post detail, and random post endpoints.
"""

from __future__ import annotations

import random
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.post import Post, SourceSite
from app.schemas.post import PostListRead, PostRead

router = APIRouter()

# Allowed per_page values (like safebooru)
ALLOWED_PER_PAGE = {20, 40, 100}


@router.get("/", response_model=PostListRead)
async def list_posts(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    per_page: int = Query(40, description="Items per page (20, 40, or 100)"),
    db: AsyncSession = Depends(get_db),
):
    """Paginated list of posts, newest first.

    Like safebooru, supports per_page=20/40/100.
    """
    # Validate per_page
    if per_page not in ALLOWED_PER_PAGE:
        per_page = 40

    # Total count
    count_stmt = select(func.count()).select_from(Post)
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Paginated query
    offset = (page - 1) * per_page
    stmt = (
        select(Post)
        .order_by(Post.created_at.desc())
        .offset(offset)
        .limit(per_page)
    )
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
):
    """Look up a post by source site and source ID.

    Useful for the Telegram bot to check if an image has already been saved.
    """
    try:
        site_enum = SourceSite(source_site)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid source_site: {source_site}. "
            f"Valid values: {[s.value for s in SourceSite]}",
        )

    stmt = select(Post).where(
        Post.source_site == site_enum,
        Post.source_id == source_id,
    )
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()

    if post is None:
        raise HTTPException(status_code=404, detail=f"Post from {source_site}:{source_id} not found")

    return post


@router.get("/random", response_model=PostRead)
async def random_post(
    db: AsyncSession = Depends(get_db),
):
    """Return a single random post.

    Uses PostgreSQL's RANDOM() for efficient random selection.
    """
    # Get total count first
    count_stmt = select(func.count()).select_from(Post)
    count_result = await db.execute(count_stmt)
    total = count_result.scalar() or 0

    if total == 0:
        raise HTTPException(status_code=404, detail="No posts found")

    # Random offset approach — efficient for large tables
    random_offset = random.randint(0, total - 1)
    stmt = select(Post).order_by(Post.created_at.desc()).offset(random_offset).limit(1)
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()

    if post is None:
        raise HTTPException(status_code=404, detail="No posts found")

    return post


@router.get("/{post_id}", response_model=PostRead)
async def get_post(
    post_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single post by ID, including its tags."""
    stmt = select(Post).where(Post.id == post_id)
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()

    if post is None:
        raise HTTPException(status_code=404, detail=f"Post {post_id} not found")

    return post