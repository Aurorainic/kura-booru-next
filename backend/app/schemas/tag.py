from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.tag import TagCategory


class TagCreate(BaseModel):
    """Schema for creating a new tag."""

    name: str
    category: TagCategory = TagCategory.general


class TagRead(BaseModel):
    """Schema for reading a single tag."""

    id: uuid.UUID
    name: str
    category: TagCategory
    post_count: int

    model_config = {"from_attributes": True}


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