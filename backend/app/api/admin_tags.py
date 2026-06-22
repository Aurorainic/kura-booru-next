"""REST API routes for admin tag management.

Provides tag listing, editing, merging, and AI reprocessing endpoints.
All endpoints require admin authentication.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_admin
from app.database import get_db
from app.models.admin import Admin
from app.models.post import Post
from app.models.post_tag import PostTag
from app.models.tag import Tag, TagCategory
from app.models.tag_knowledge import TagKnowledge
from app.schemas.tag import (
    TagKnowledgeRead,
    TagListRead,
    TagMergeRequest,
    TagRead,
    TagReprocessRequest,
    TagUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_PER_PAGE = {20, 40, 100}


@router.get("/", response_model=TagListRead)
async def list_admin_tags(
    category: str | None = Query(None, description="Filter by tag category"),
    ai_status: str | None = Query(
        None, description="Filter by AI processing status: processed, unprocessed"
    ),
    q: str | None = Query(None, description="Search tag name prefix"),
    sort: str = Query("count", description="Sort by 'count' or 'name'"),
    page: int = Query(1, ge=1),
    per_page: int = Query(40, description="Items per page (20, 40, or 100)"),
    db: AsyncSession = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
):
    """Paginated tag list for admin with AI processing status filter."""
    if per_page not in ALLOWED_PER_PAGE:
        per_page = 40

    stmt = select(Tag)

    # Category filter
    if category:
        try:
            category_enum = TagCategory(category)
            stmt = stmt.where(Tag.category == category_enum)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid category: {category}. "
                f"Valid: {[c.value for c in TagCategory]}",
            )

    # AI status filter
    if ai_status == "processed":
        stmt = stmt.where(Tag.ai_processed_at.isnot(None))
    elif ai_status == "unprocessed":
        stmt = stmt.where(Tag.ai_processed_at.is_(None))

    # Name prefix search
    if q:
        stmt = stmt.where(Tag.name.ilike(f"{q}%"))

    # Total count
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Sorting
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


@router.patch("/{tag_id}", response_model=TagRead)
async def update_tag(
    tag_id: uuid.UUID,
    body: TagUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
):
    """Update a tag's category, danbooru_name, or translation.

    After manual editing, marks the corresponding tag_knowledge
    entry source as 'manual'.
    """
    stmt = select(Tag).where(Tag.id == tag_id)
    result = await db.execute(stmt)
    tag = result.scalar_one_or_none()

    if tag is None:
        raise HTTPException(status_code=404, detail="Tag not found")

    update_data = body.model_dump(exclude_unset=True)
    if not update_data:
        return TagRead.model_validate(tag)

    # Apply updates
    for field, value in update_data.items():
        setattr(tag, field, value)

    # Update tag_knowledge source to 'manual' if entry exists
    if tag.name:
        tk_stmt = select(TagKnowledge).where(TagKnowledge.name == tag.name)
        tk_result = await db.execute(tk_stmt)
        tk = tk_result.scalar_one_or_none()

        if tk:
            # Update the knowledge entry to match
            if body.category is not None:
                tk.type = body.category.value
            if body.danbooru_name is not None:
                tk.danbooru_name = body.danbooru_name
            if body.translation is not None:
                tk.translation = body.translation
            tk.source = "manual"
        else:
            # Create a knowledge entry with manual source
            new_tk = TagKnowledge(
                name=tag.name,
                type=tag.category.value,
                danbooru_name=tag.danbooru_name,
                translation=tag.translation,
                source="manual",
            )
            db.add(new_tk)

    await db.commit()
    await db.refresh(tag)
    return TagRead.model_validate(tag)


@router.post("/merge")
async def merge_tags(
    body: TagMergeRequest,
    db: AsyncSession = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
):
    """Merge source tag into target tag.

    Moves all post associations from the source tag to the target tag,
    then deletes the source tag. The target tag's post_count is updated.
    """
    if body.source_tag_id == body.target_tag_id:
        raise HTTPException(status_code=400, detail="Cannot merge a tag into itself")

    # Load both tags
    source = await db.get(Tag, body.source_tag_id)
    target = await db.get(Tag, body.target_tag_id)

    if source is None:
        raise HTTPException(status_code=404, detail="Source tag not found")
    if target is None:
        raise HTTPException(status_code=404, detail="Target tag not found")

    # Find post_tags that reference the source tag
    pt_stmt = select(PostTag).where(PostTag.tag_id == source.id)
    pt_result = await db.execute(pt_stmt)
    source_post_tags = pt_result.scalars().all()

    moved = 0
    skipped = 0
    for pt in source_post_tags:
        # Check if target already has this post
        exists_stmt = select(PostTag).where(
            PostTag.post_id == pt.post_id, PostTag.tag_id == target.id
        )
        exists_result = await db.execute(exists_stmt)
        if exists_result.scalar_one_or_none():
            # Target already has this post — just delete the source link
            skipped += 1
            await db.delete(pt)
        else:
            # Move the association
            pt.tag_id = target.id
            moved += 1

    # Update post counts
    target.post_count = target.post_count + moved
    source.post_count = 0

    # Delete source tag
    await db.delete(source)
    await db.commit()

    return {
        "merged": True,
        "source_tag": source.name,
        "target_tag": target.name,
        "posts_moved": moved,
        "posts_skipped": skipped,
    }


@router.post("/reprocess")
async def reprocess_tags(
    body: TagReprocessRequest,
    db: AsyncSession = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
):
    """Enqueue tag reprocessing via ARQ.

    If force=True, reprocesses all tags. Otherwise only processes
    tags not yet in the knowledge base.
    """
    from app.config import settings as app_settings
    from app.tasks.worker import _parse_redis_url
    from arq import create_pool

    redis_settings = _parse_redis_url(app_settings.REDIS_URL)
    try:
        pool = await create_pool(redis_settings)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to connect to ARQ: {e}",
        )

    if body.force:
        # Reset all tags' ai_processed_at so they get reprocessed
        await db.execute(
            update(Tag).values(ai_processed_at=None)
        )
        await db.commit()

    job = await pool.enqueue_job("reprocess_tags", force=body.force)
    await pool.aclose()

    return {
        "enqueued": True,
        "job_id": job.job_id,
        "force": body.force,
    }


@router.get("/knowledge", response_model=list[TagKnowledgeRead])
async def list_tag_knowledge(
    source: str | None = Query(None, description="Filter by source (ai/manual/danbooru_import/danbooru_api)"),
    page: int = Query(1, ge=1),
    per_page: int = Query(40, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
):
    """List tag knowledge entries for admin inspection."""
    stmt = select(TagKnowledge)

    if source:
        stmt = stmt.where(TagKnowledge.source == source)

    stmt = stmt.order_by(TagKnowledge.name.asc())
    stmt = stmt.offset((page - 1) * per_page).limit(per_page)

    result = await db.execute(stmt)
    entries = result.scalars().all()
    return [TagKnowledgeRead.model_validate(e) for e in entries]
