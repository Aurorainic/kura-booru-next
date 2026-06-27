"""Pydantic schemas for the admin dashboard endpoint.

Single-round-trip aggregation of overview metrics + distribution + top-N
lists. Admin-only (see `GET /api/admin/dashboard/`).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class OverviewStats(BaseModel):
    """Top-level counts for the dashboard header cards."""

    total_posts: int
    total_tags: int
    total_post_tags: int
    total_file_size_bytes: int


class SourceBreakdownItem(BaseModel):
    """One row of the source-site distribution chart."""

    source_site: str
    count: int


class RatingBreakdownItem(BaseModel):
    """One row of the content-rating distribution chart."""

    rating: str
    count: int


class TopTagItem(BaseModel):
    """One row of the top-tags ranking."""

    id: uuid.UUID
    name: str
    category: str
    post_count: int


class RecentPostItem(BaseModel):
    """One thumbnail in the recent-posts grid."""

    id: uuid.UUID
    thumb_key: str
    title: str | None
    rating: str
    source_site: str
    created_at: datetime


class DashboardResponse(BaseModel):
    """Aggregated response for `GET /api/admin/dashboard/`."""

    overview: OverviewStats
    source_breakdown: list[SourceBreakdownItem]
    rating_breakdown: list[RatingBreakdownItem]
    top_tags: list[TopTagItem]
    recent_posts: list[RecentPostItem]
