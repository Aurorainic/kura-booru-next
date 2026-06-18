"""REST API routes for tags.

Provides tag listing with filtering by category and sorting,
single tag detail with associated posts, and tag autocomplete.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.tag import Tag, TagCategory
from app.models.tag_alias import TagAlias
from app.schemas.tag import TagListRead, TagRead

router = APIRouter()

# Allowed per_page values
ALLOWED_PER_PAGE = {20, 40, 100}


@router.get("/", response_model=TagListRead)
async def list_tags(
    category: str | None = Query(None, description="Filter by tag category"),
    sort: str = Query("count", description="Sort by 'count' or 'name'"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    per_page: int = Query(40, description="Items per page (20, 40, or 100)"),
    db: AsyncSession = Depends(get_db),
):
    """Paginated tag list with category filtering and sorting.

    Supports sorting by post count (default) or name alphabetically.
    """
    # Validate per_page
    if per_page not in ALLOWED_PER_PAGE:
        per_page = 40

    # Base query
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
        # Default: sort by post count descending
        stmt = stmt.order_by(Tag.post_count.desc())

    # Pagination
    offset = (page - 1) * per_page
    stmt = stmt.offset(offset).limit(per_page)

    result = await db.execute(stmt)
    tags = result.scalars().all()

    return TagListRead.from_page(
        items=tags,
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/autocomplete", response_model=list[TagRead])
async def autocomplete_tags(
    q: str = Query(..., min_length=1, description="Search prefix for tag names"),
    per_page: int = Query(10, ge=1, le=50, description="Maximum results to return"),
    db: AsyncSession = Depends(get_db),
):
    """Autocomplete tag names by prefix.

    Returns tags whose names start with the query string (case-insensitive),
    sorted by post count descending.
    """
    stmt = (
        select(Tag)
        .where(Tag.name.ilike(f"{q}%"))
        .order_by(Tag.post_count.desc())
        .limit(per_page)
    )
    result = await db.execute(stmt)
    tags = result.scalars().all()
    return list(tags)


@router.get("/{tag_name}", response_model=TagRead)
async def get_tag(
    tag_name: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single tag by name.

    Also resolves tag aliases — if the name is an alias,
    returns the canonical tag instead.
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

    return tag