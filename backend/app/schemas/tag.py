from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.tag import TagCategory


class TagRead(BaseModel):
    """Schema for reading a single tag."""

    id: uuid.UUID
    name: str
    category: TagCategory
    post_count: int
    danbooru_name: str | None = None
    translation: str | None = None

    model_config = {"from_attributes": True}


class TagUpdate(BaseModel):
    """Schema for updating a tag (admin)."""

    category: TagCategory | None = None
    danbooru_name: str | None = None
    translation: str | None = None


class TagKnowledgeRead(BaseModel):
    """Schema for reading a tag knowledge entry."""

    id: uuid.UUID
    name: str
    danbooru_name: str | None = None
    type: TagCategory
    translation: str | None = None
    source: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TagMergeRequest(BaseModel):
    """Schema for merging tags (admin)."""

    source_tag_id: uuid.UUID
    target_tag_id: uuid.UUID


class TagMergeResponse(BaseModel):
    """Schema for tag merge result.

    All counts are verified after the merge commits.
    """

    merged: bool
    source_tag_id: uuid.UUID
    source_tag_name: str
    target_tag_id: uuid.UUID
    target_tag_name: str
    posts_moved: int  # New associations added to target
    posts_skipped: int  # Source associations that were already in target
    target_old_post_count: int  # Target's count BEFORE merge
    target_new_post_count: int  # Target's count AFTER merge (verified)


class TagReprocessRequest(BaseModel):
    """Schema for triggering tag reprocessing (admin)."""

    force: bool = False  # If True, reprocess all tags; otherwise only pending/error


class TagListRead(BaseModel):
    """Schema for paginated tag list responses."""

    items: list[TagRead]
    total: int
    page: int
    per_page: int
    total_pages: int

    @classmethod
    def from_page(
        cls,
        items: list,
        total: int,
        page: int,
        per_page: int,
    ) -> "TagListRead":
        total_pages = (total + per_page - 1) // per_page if per_page > 0 else 0
        return cls(
            items=items,
            total=total,
            page=page,
            per_page=per_page,
            total_pages=total_pages,
        )