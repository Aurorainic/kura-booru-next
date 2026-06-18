"""Cache purge webhook.

Provides an endpoint to purge Caddy Souin cache for specific paths.
This is called after new images are uploaded to ensure the SSR cache
is invalidated and fresh content is served.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

router = APIRouter()


class PurgeRequest(BaseModel):
    """Request body for cache purge."""

    paths: list[str] = Field(
        ...,
        description="List of URL paths to purge from cache (e.g., ['/api/posts', '/api/posts/123'])",
    )


class PurgeResponse(BaseModel):
    """Response after purging cache."""

    purged: list[str] = Field(..., description="Paths that were purged")
    errors: list[str] = Field(default_factory=list, description="Any errors encountered")


@router.post("/", response_model=PurgeResponse)
async def purge_cache(request: PurgeRequest):
    """Purge Caddy Souin cache for the specified paths.

    Called after new content is uploaded to invalidate the SSR cache
    so that the next request fetches fresh content from the backend.

    The Caddy Souin plugin supports cache purging via HTTP requests.
    """
    purged: list[str] = []
    errors: list[str] = []

    # Caddy Souin purge API: send PURGE method to the path
    # The internal Caddy URL is the APP_URL (frontend + backend)
    base_url = settings.APP_URL.rstrip("/")

    async with httpx.AsyncClient(timeout=10.0) as client:
        for path in request.paths:
            # Normalize path
            path = path.strip()
            if not path.startswith("/"):
                path = "/" + path

            url = f"{base_url}{path}"

            try:
                # Souin cache purge: use PURGE HTTP method
                response = await client.request("PURGE", url)
                if response.status_code in (200, 204, 404):
                    # 404 is fine — means the path wasn't cached
                    purged.append(path)
                    logger.info("Purged cache for path: %s", path)
                else:
                    error_msg = f"Purge failed for {path}: HTTP {response.status_code}"
                    errors.append(error_msg)
                    logger.warning(error_msg)
            except httpx.RequestError as exc:
                error_msg = f"Purge error for {path}: {exc}"
                errors.append(error_msg)
                logger.warning(error_msg)

    return PurgeResponse(purged=purged, errors=errors)