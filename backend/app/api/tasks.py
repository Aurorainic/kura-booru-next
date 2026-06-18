"""Task creation endpoint.

Provides an API to enqueue image processing tasks to the ARQ worker.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.tasks.worker import enqueue_process_image

router = APIRouter()


class ProcessImageRequest(BaseModel):
    """Request body for creating an image processing task."""

    source_url: str = Field(..., description="URL of the image to process")
    source_site: str | None = Field(None, description="Pre-resolved source site (pixiv, twitter, danbooru, other)")
    source_id: str | None = Field(None, description="Pre-resolved source ID on the site")


class ProcessImageResponse(BaseModel):
    """Response after enqueuing an image processing task."""

    task_id: str = Field(..., description="ARQ task/job ID for tracking")
    status: str = Field(default="queued", description="Task status")


@router.post("/", response_model=ProcessImageResponse)
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