from __future__ import annotations

import logging
from typing import Any

import aiohttp

from app.config import settings

logger = logging.getLogger(__name__)

_session: aiohttp.ClientSession | None = None


async def get_session() -> aiohttp.ClientSession:
    """Get or create the shared aiohttp client session.

    If BACKEND_API_KEY is configured, every request automatically carries the
    X-Api-Key header so that gated backend endpoints (POST /api/tasks/, etc.)
    accept the call.
    """
    global _session
    if _session is None or _session.closed:
        headers: dict[str, str] = {}
        if settings.BACKEND_API_KEY:
            headers["X-Api-Key"] = settings.BACKEND_API_KEY
        _session = aiohttp.ClientSession(
            base_url=settings.BACKEND_API_URL,
            timeout=aiohttp.ClientTimeout(total=30),
            headers=headers or None,
        )
    return _session


async def close_session() -> None:
    """Close the shared aiohttp session on shutdown."""
    global _session
    if _session is not None and not _session.closed:
        await _session.close()
        _session = None


async def get_post(post_id: str) -> dict[str, Any] | None:
    """Fetch a post by ID from the backend API.

    Returns the post dict or None if not found.
    """
    session = await get_session()
    try:
        async with session.get(f"/api/posts/{post_id}") as resp:
            if resp.status == 404:
                return None
            resp.raise_for_status()
            return await resp.json()
    except aiohttp.ClientError as exc:
        logger.error("Failed to fetch post %s: %s", post_id, exc)
        return None


async def get_post_by_source(source_site: str, source_id: str) -> dict[str, Any] | None:
    """Fetch a post by source site and source ID from the backend API.

    Returns the post dict or None if not found.
    """
    session = await get_session()
    try:
        params = {"source_site": source_site, "source_id": source_id}
        async with session.get("/api/posts/by-source", params=params) as resp:
            if resp.status == 404:
                return None
            resp.raise_for_status()
            return await resp.json()
    except aiohttp.ClientError as exc:
        logger.error("Failed to fetch post by source %s:%s: %s", source_site, source_id, exc)
        return None


async def search_posts(
    query: str,
    page: int = 1,
    per_page: int = 10,
) -> dict[str, Any] | None:
    """Search posts via the backend API.

    Returns a dict with 'items', 'total', 'page', 'per_page' or None on error.
    """
    session = await get_session()
    try:
        params = {"q": query, "page": str(page), "per_page": str(per_page)}
        async with session.get("/api/search/", params=params) as resp:
            resp.raise_for_status()
            return await resp.json()
    except aiohttp.ClientError as exc:
        logger.error("Failed to search posts (q=%r): %s", query, exc)
        return None


async def create_process_task(
    source_url: str,
    source_site: str,
    source_id: str,
) -> dict[str, Any] | None:
    """Create a processing task on the backend.

    Returns the task dict with 'task_id' etc., or None on error.
    """
    session = await get_session()
    try:
        payload = {
            "source_url": source_url,
            "source_site": source_site,
            "source_id": source_id,
        }
        async with session.post("/api/tasks/", json=payload) as resp:
            resp.raise_for_status()
            return await resp.json()
    except aiohttp.ClientError as exc:
        logger.error("Failed to create process task for %s: %s", source_url, exc)
        return None


async def update_post_rating(post_id: str, rating: str) -> bool:
    """Update a post's rating via PATCH /api/posts/{id}.

    Returns True on success, False on failure.
    The X-Api-Key header is automatically sent by the shared session.
    """
    session = await get_session()
    try:
        async with session.patch(
            f"/api/posts/{post_id}",
            json={"rating": rating},
        ) as resp:
            if resp.status == 200:
                return True
            logger.warning(
                "Failed to update rating for post %s: HTTP %d",
                post_id, resp.status,
            )
            return False
    except aiohttp.ClientError as exc:
        logger.error("Failed to update rating for post %s: %s", post_id, exc)
        return False
