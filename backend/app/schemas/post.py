from __future__ import annotations

import re
import uuid
from datetime import datetime
from html import unescape as html_unescape
from typing import Optional

import bleach
from pydantic import BaseModel, Field, model_serializer

from app.models.post import SourceSite
from app.schemas.tag import TagRead

# Tags allowed in descriptions (safe subset of HTML)
_ALLOWED_TAGS = ["a", "br", "p", "b", "i", "strong", "em", "ul", "ol", "li", "span", "u"]
_ALLOWED_ATTRS = {"a": ["href", "title"]}


def sanitize_description_html(raw: str | None) -> str | None:
    """Sanitize HTML description from source sites (Pixiv, etc.).

    - Strips dangerous tags (script, iframe, etc.)
    - Adds target="_blank" rel="noopener noreferrer" to links
    - Returns plain text (no HTML) for meta tag usage.
    """
    if not raw or not raw.strip():
        return None

    cleaned = bleach.clean(raw, tags=_ALLOWED_TAGS, attributes=_ALLOWED_ATTRS, strip=True)

    # Add target="_blank" and rel to all <a> tags
    def _add_target(match: re.Match) -> str:
        tag = match.group(0)
        if 'target=' not in tag:
            tag = tag.replace('>', ' target="_blank" rel="noopener noreferrer">', 1)
        elif 'rel=' not in tag:
            tag = tag.replace('>', ' rel="noopener noreferrer">', 1)
        return tag

    cleaned = re.sub(r"<a\b[^>]*>", _add_target, cleaned)
    return cleaned


def description_to_plain_text(raw: str | None) -> str | None:
    """Strip all HTML tags for use in meta description tags."""
    if not raw or not raw.strip():
        return None
    text = re.sub(r"<[^>]+>", "", raw)
    text = html_unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


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

    @model_serializer(mode="wrap")
    def _sanitize_description(self, handler) -> dict:
        data = handler(self)
        raw_desc = data.get("description")
        if raw_desc:
            data["description"] = sanitize_description_html(raw_desc)
        return data


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