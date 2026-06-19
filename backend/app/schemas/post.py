from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.post import SourceSite
from app.schemas.tag import TagRead


class PostRead(BaseModel):
    """Schema for reading a single post with its tags."""

    id: uuid.UUID
    s3_key: str
    thumb_key: str
    preview_key: str
    source_url: str
    source_site: SourceSite
    source_id: str
    width: int
    height: int
    file_size: int
    mime_type: str
    title: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime
    tags: list[TagRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class PostListRead(BaseModel):
    """Schema for paginated post list responses."""

    items: list[PostRead]
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
    ) -> "PostListRead":
        total_pages = (total + per_page - 1) // per_page if per_page > 0 else 0
        return cls(
            items=items,
            total=total,
            page=page,
            per_page=per_page,
            total_pages=total_pages,
        )