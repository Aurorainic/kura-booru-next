"""Task creation endpoints.

Provides APIs to enqueue image processing tasks to the ARQ worker:
- POST /api/tasks/         — bot/internal, requires X-Api-Key
- POST /api/tasks/web-import — admin web UI, requires admin session
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import get_current_admin, require_api_key
from app.models.admin import Admin
from app.tasks.worker import enqueue_process_image

router = APIRouter()

logger = logging.getLogger(__name__)


class ProcessImageRequest(BaseModel):
    """Request body for creating an image processing task."""

    source_url: str = Field(..., description="URL of the image to process")
    source_site: str | None = Field(None, description="Pre-resolved source site (pixiv, twitter, danbooru, other)")
    source_id: str | None = Field(None, description="Pre-resolved source ID on the site")


class ProcessImageResponse(BaseModel):
    """Response after enqueuing an image processing task."""

    task_id: str = Field(..., description="ARQ task/job ID for tracking")
    status: str = Field(default="queued", description="Task status")


@router.post("/", response_model=ProcessImageResponse, dependencies=[Depends(require_api_key)])
async def create_process_task(request: ProcessImageRequest):
    """Create a new image processing task.

    Enqueues the task to the ARQ worker for background processing.
    Returns the task ID for status tracking.
    """
    if not request.source_url.strip():
        raise HTTPException(status_code=400, detail="source_url is required")

    try:
        task_id = await enqueue_process_image(
            source_url=request.source_url,
            source_site=request.source_site,
            source_id=request.source_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to enqueue task: {exc}",
        )

    return ProcessImageResponse(task_id=task_id, status="queued")


class WebImportRequest(BaseModel):
    """Request body for web-based batch image import."""

    urls: list[str] = Field(..., description="List of image URLs to import")


class WebImportResponse(BaseModel):
    """Response after enqueuing batch import tasks."""

    results: list[ProcessImageResponse] = Field(
        default_factory=list,
        description="Per-URL task creation results",
    )


@router.post("/web-import", response_model=WebImportResponse)
async def web_import(
    request: WebImportRequest,
    admin: Admin = Depends(get_current_admin),
):
    """Import images from URLs via the admin web UI.

    Uses admin session auth instead of API key.
    Enqueues each URL as a separate ARQ task.
    Returns per-URL results with task IDs or error status.
    """
    results: list[ProcessImageResponse] = []

    for url in request.urls:
        url = url.strip()
        if not url:
            continue

        try:
            task_id = await enqueue_process_image(source_url=url)
            results.append(ProcessImageResponse(task_id=task_id, status="queued"))
        except Exception as exc:
            logger.warning("Failed to enqueue task for %s: %s", url, exc)
            results.append(ProcessImageResponse(task_id="", status="error"))

    return WebImportResponse(results=results)
