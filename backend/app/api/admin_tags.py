"""REST API routes for admin tag management.

Provides tag listing, editing, merging, and AI reprocessing endpoints.
All endpoints require admin authentication.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select, update
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
    TagMergeResponse,
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


@router.post("/merge", response_model=TagMergeResponse)
async def merge_tags(
    body: TagMergeRequest,
    db: AsyncSession = Depends(get_db),
    _admin: Admin = Depends(get_current_admin),
):
    """Merge source tag into target tag with verified post_count consistency.

    Algorithm:
      1. Load both tags (404 if missing) with row-level lock to serialize
         concurrent merges on the same tag pair.
      2. Reject self-merge (400).
      3. Bulk-fetch source.post_tags and target.post_tags (1+1 queries, no N+1).
      4. Compute set difference: posts to move vs posts to delete.
      5. DELETE PostTag rows for skipped (already in target).
      6. UPDATE PostTag.tag_id for moved (bulk).
      7. Recompute target.post_count via COUNT(*) — single source of truth.
      8. DELETE source tag.
      9. Single commit (atomic).

    Returns verified counts so the UI can show a confirmation toast.
    """
    if body.source_tag_id == body.target_tag_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot merge a tag into itself",
        )

    # ── 1. Load tags (with row-level lock to prevent concurrent merges) ──
    source = await db.get(
        Tag, body.source_tag_id, with_for_update=True
    )
    target = await db.get(
        Tag, body.target_tag_id, with_for_update=True
    )

    if source is None:
        raise HTTPException(
            status_code=404,
            detail=f"Source tag not found: {body.source_tag_id}",
        )
    if target is None:
        raise HTTPException(
            status_code=404,
            detail=f"Target tag not found: {body.target_tag_id}",
        )

    # ── 2. Bulk-fetch post_ids (2 queries, no N+1) ──
    source_post_ids_stmt = select(PostTag.post_id).where(
        PostTag.tag_id == source.id
    )
    target_post_ids_stmt = select(PostTag.post_id).where(
        PostTag.tag_id == target.id
    )

    source_post_ids = set(
        (await db.execute(source_post_ids_stmt)).scalars().all()
    )
    target_post_ids = set(
        (await db.execute(target_post_ids_stmt)).scalars().all()
    )

    # ── 3. Compute set difference ──
    to_move_ids = source_post_ids - target_post_ids  # need to be added
    to_delete_ids = source_post_ids & target_post_ids  # already in target, drop

    # ── 4. Apply changes ──
    if to_delete_ids:
        await db.execute(
            delete(PostTag).where(
                PostTag.tag_id == source.id,
                PostTag.post_id.in_(to_delete_ids),
            )
        )

    if to_move_ids:
        await db.execute(
            update(PostTag)
            .where(
                PostTag.tag_id == source.id,
                PostTag.post_id.in_(to_move_ids),
            )
            .values(tag_id=target.id)
        )

    # ── 5. Recompute target.post_count (single source of truth) ──
    new_count_stmt = select(func.count()).select_from(PostTag).where(
        PostTag.tag_id == target.id
    )
    target_new_count = (await db.execute(new_count_stmt)).scalar() or 0
    target.post_count = target_new_count

    # ── 6. Delete source tag (post_count field is removed along with row) ──
    await db.delete(source)

    # ── 7. Single atomic commit ──
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.exception(
            "merge_tags failed: source=%s target=%s", source.id, target.id
        )
        raise HTTPException(
            status_code=500,
            detail=f"Merge failed, transaction rolled back: {e}",
        )

    return TagMergeResponse(
        merged=True,
        source_tag_id=source.id,
        source_tag_name=source.name,
        target_tag_id=target.id,
        target_tag_name=target.name,
        posts_moved=len(to_move_ids),
        posts_skipped=len(to_delete_ids),
        target_new_post_count=target_new_count,
        target_old_post_count=len(target_post_ids),
    )


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
