"""REST API routes for tags.

Provides tag listing with filtering by category and sorting,
single tag detail with associated posts, and tag autocomplete.

Visibility: anonymous callers only see tags associated with safe-rated
posts. Tags that only belong to non-safe posts are completely hidden
from tag lists, tag cloud, and autocomplete for non-admin users.
Admin users see the full denormalized post_count including all ratings.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_is_admin
from app.database import get_db
from app.api.constants import ALLOWED_PER_PAGE
from app.models.post import Post, Rating
from app.models.post_tag import PostTag
from app.models.tag import Tag, TagCategory
from app.models.tag_alias import TagAlias
from app.schemas.tag import TagListRead, TagRead

router = APIRouter()


def _safe_post_count_subquery():
    """Correlated scalar subquery counting only safe-rated posts per tag.

    Used for non-admin callers so that:
    - post_count reflects only safe posts
    - tags with 0 safe posts can be filtered out
    """
    return (
        select(func.count(PostTag.post_id))
        .where(PostTag.tag_id == Tag.id)
        .where(
            PostTag.post_id.in_(
                select(Post.id).where(Post.rating == Rating.safe)
            )
        )
        .correlate(Tag)
        .scalar_subquery()
    )


@router.get("/", response_model=TagListRead)
async def list_tags(
    category: str | None = Query(None, description="Filter by tag category"),
    sort: str = Query("count", description="Sort by 'count' or 'name'"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    per_page: int = Query(40, description="Items per page (20, 40, or 100)"),
    db: AsyncSession = Depends(get_db),
    is_admin: bool = Depends(get_is_admin),
):
    """Paginated tag list with category filtering and sorting.

    Anonymous callers only see tags with at least one safe post,
    with post_count reflecting only safe posts. Admin sees all tags
    with the full denormalized post_count.
    """
    # Validate per_page
    if per_page not in ALLOWED_PER_PAGE:
        per_page = 40

    if is_admin:
        # Admin: use denormalized post_count directly
        stmt = select(Tag)

        # Filter by category if specified
        if category:
            try:
                category_enum = TagCategory(category)
                stmt = stmt.where(Tag.category == category_enum)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid category: {category}. "
                    f"Valid categories: {[c.value for c in TagCategory]}",
                )

        # Total count (with filter applied)
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_result = await db.execute(count_stmt)
        total = total_result.scalar() or 0

        # Apply sorting
        if sort == "name":
            stmt = stmt.order_by(Tag.name.asc())
        else:
            stmt = stmt.order_by(Tag.post_count.desc())

        # Pagination
        offset = (page - 1) * per_page
        stmt = stmt.offset(offset).limit(per_page)

        result = await db.execute(stmt)
        tags = result.scalars().all()

        return TagListRead.from_page(
            items=[TagRead.model_validate(t) for t in tags],
            total=total,
            page=page,
            per_page=per_page,
        )
    else:
        # Non-admin: compute safe-only post_count, hide tags with 0 safe posts
        safe_count = _safe_post_count_subquery()
        stmt = select(Tag, safe_count.label("safe_post_count"))

        # Filter by category if specified
        if category:
            try:
                category_enum = TagCategory(category)
                stmt = stmt.where(Tag.category == category_enum)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid category: {category}. "
                    f"Valid categories: {[c.value for c in TagCategory]}",
                )

        # Filter out tags with 0 safe posts
        stmt = stmt.where(safe_count > 0)

        # Total count (with all filters applied)
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_result = await db.execute(count_stmt)
        total = total_result.scalar() or 0

        # Apply sorting
        if sort == "name":
            stmt = stmt.order_by(Tag.name.asc())
        else:
            stmt = stmt.order_by(safe_count.desc())

        # Pagination
        offset = (page - 1) * per_page
        stmt = stmt.offset(offset).limit(per_page)

        result = await db.execute(stmt)
        rows = result.all()

        tag_reads = [
            TagRead(
                id=row[0].id,
                name=row[0].name,
                category=row[0].category,
                post_count=row[1],
            )
            for row in rows
        ]

        return TagListRead.from_page(
            items=tag_reads,
            total=total,
            page=page,
            per_page=per_page,
        )


@router.get("/autocomplete", response_model=list[TagRead])
async def autocomplete_tags(
    q: str = Query(..., min_length=1, description="Search prefix for tag names"),
    per_page: int = Query(10, ge=1, le=50, description="Maximum results to return"),
    db: AsyncSession = Depends(get_db),
    is_admin: bool = Depends(get_is_admin),
):
    """Autocomplete tag names by prefix.

    Returns tags whose names start with the query string (case-insensitive),
    sorted by post count descending. For non-admin callers, only tags with
    at least one safe post are returned, with safe-only post_count.
    """
    if is_admin:
        stmt = (
            select(Tag)
            .where(Tag.name.ilike(f"{q}%"))
            .order_by(Tag.post_count.desc())
            .limit(per_page)
        )
        result = await db.execute(stmt)
        tags = result.scalars().all()
        return [TagRead.model_validate(t) for t in tags]
    else:
        safe_count = _safe_post_count_subquery()
        stmt = (
            select(Tag, safe_count.label("safe_post_count"))
            .where(Tag.name.ilike(f"{q}%"))
            .where(safe_count > 0)
            .order_by(safe_count.desc())
            .limit(per_page)
        )
        result = await db.execute(stmt)
        rows = result.all()
        return [
            TagRead(
                id=row[0].id,
                name=row[0].name,
                category=row[0].category,
                post_count=row[1],
            )
            for row in rows
        ]


@router.get("/{tag_name}", response_model=TagRead)
async def get_tag(
    tag_name: str,
    db: AsyncSession = Depends(get_db),
    is_admin: bool = Depends(get_is_admin),
):
    """Get a single tag by name.

    Also resolves tag aliases — if the name is an alias,
    returns the canonical tag instead.

    For non-admin callers, returns 404 if the tag has 0 safe posts
    (tag effectively doesn't exist for anonymous users).
    """
    # First, try to find the tag directly
    stmt = select(Tag).where(Tag.name == tag_name)
    result = await db.execute(stmt)
    tag = result.scalar_one_or_none()

    if tag is None:
        # Check if it's an alias
        alias_stmt = select(TagAlias).where(TagAlias.alias_name == tag_name)
        alias_result = await db.execute(alias_stmt)
        alias = alias_result.scalar_one_or_none()

        if alias:
            # Return the canonical tag
            tag_stmt = select(Tag).where(Tag.id == alias.tag_id)
            tag_result = await db.execute(tag_stmt)
            tag = tag_result.scalar_one_or_none()

    if tag is None:
        raise HTTPException(status_code=404, detail=f"Tag '{tag_name}' not found")

    if is_admin:
        return TagRead.model_validate(tag)
    else:
        # Non-admin: check safe post count; return 404 if 0
        safe_count = _safe_post_count_subquery()
        count_stmt = select(safe_count.label("safe_post_count")).where(Tag.id == tag.id)
        count_result = await db.execute(count_stmt)
        row = count_result.one_or_none()

        if row is None or row[0] == 0:
            raise HTTPException(status_code=404, detail=f"Tag '{tag_name}' not found")

        return TagRead(
            id=tag.id,
            name=tag.name,
            category=tag.category,
            post_count=row[0],
        )
