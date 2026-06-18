"""Search API for posts by tags.

Supports tag-based search with inclusion and exclusion:
  q=tag1+tag2          → posts with tag1 AND tag2
  q=tag1+-tag2         → posts with tag1 but NOT tag2

Returns paginated results with post + tag data.
"""

from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.post import Post
from app.models.post_tag import PostTag
from app.models.tag import Tag
from app.models.tag_alias import TagAlias
from app.schemas.post import PostListRead

router = APIRouter()

# Allowed per_page values
ALLOWED_PER_PAGE = {20, 40, 100}


def _parse_query(q: str) -> tuple[list[str], list[str]]:
    """Parse a search query string into include and exclude tag lists.

    Tags are separated by '+' (or spaces).
    A tag prefixed with '-' is excluded.

    Examples:
        "tag1+tag2"      → (["tag1", "tag2"], [])
        "tag1+-tag2"     → (["tag1"], ["tag2"])
        "tag1 -tag2"     → (["tag1"], ["tag2"])
    """
    include_tags: list[str] = []
    exclude_tags: list[str] = []

    # Split by '+' or spaces
    tokens = re.split(r"[+\s]+", q.strip())

    for token in tokens:
        token = token.strip().lower()
        if not token:
            continue
        if token.startswith("-"):
            tag_name = token[1:].strip()
            if tag_name:
                exclude_tags.append(tag_name)
        else:
            include_tags.append(token)

    return include_tags, exclude_tags


async def _resolve_tag_name(db: AsyncSession, name: str) -> uuid.UUID | None:
    """Resolve a tag name to its ID, following aliases.

    Returns the tag ID or None if not found.
    """
    # Direct lookup
    stmt = select(Tag.id).where(Tag.name == name)
    result = await db.execute(stmt)
    tag_id = result.scalar_one_or_none()

    if tag_id is not None:
        return tag_id

    # Check aliases
    alias_stmt = select(TagAlias.tag_id).where(TagAlias.alias_name == name)
    alias_result = await db.execute(alias_stmt)
    return alias_result.scalar_one_or_none()


@router.get("/", response_model=PostListRead)
async def search_posts(
    q: str = Query(..., description="Search query: tag1+tag2+-exclude_tag"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    per_page: int = Query(40, description="Items per page (20, 40, or 100)"),
    db: AsyncSession = Depends(get_db),
):
    """Search posts by tags.

    Supports inclusion and exclusion:
      q=tag1+tag2       → posts with BOTH tag1 AND tag2
      q=tag1+-tag2      → posts with tag1 but NOT tag2
    """
    # Validate per_page
    if per_page not in ALLOWED_PER_PAGE:
        per_page = 40

    include_names, exclude_names = _parse_query(q)

    # Resolve tag names to IDs
    include_ids: list[uuid.UUID] = []
    exclude_ids: list[uuid.UUID] = []

    for name in include_names:
        tag_id = await _resolve_tag_name(db, name)
        if tag_id is not None:
            include_ids.append(tag_id)

    for name in exclude_names:
        tag_id = await _resolve_tag_name(db, name)
        if tag_id is not None:
            exclude_ids.append(tag_id)

    # If no valid include tags found, return empty results
    if not include_ids:
        return PostListRead.from_page(
            items=[],
            total=0,
            page=page,
            per_page=per_page,
        )

    # Build query: find posts that have ALL include tags
    # Using intersection approach: join post_tags for each include tag
    base_stmt = select(Post)

    for tag_id in include_ids:
        # Post must have this tag
        exists_stmt = (
            select(PostTag.post_id)
            .where(PostTag.tag_id == tag_id)
            .correlate(Post)
        )
        base_stmt = base_stmt.where(Post.id.in_(exists_stmt))

    # Post must NOT have any of the exclude tags
    for tag_id in exclude_ids:
        not_exists_stmt = (
            select(PostTag.post_id)
            .where(PostTag.tag_id == tag_id)
            .correlate(Post)
        )
        base_stmt = base_stmt.where(Post.id.notin_(not_exists_stmt))

    # Count total matching posts
    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Paginated results
    offset = (page - 1) * per_page
    paginated_stmt = (
        base_stmt.order_by(Post.created_at.desc()).offset(offset).limit(per_page)
    )
    result = await db.execute(paginated_stmt)
    posts = result.scalars().all()

    return PostListRead.from_page(
        items=posts,
        total=total,
        page=page,
        per_page=per_page,
    )