"""Task creation endpoints.

Provides APIs to enqueue image processing tasks to the ARQ worker:
- POST /api/tasks/         — bot/internal, requires X-Api-Key
- POST /api/tasks/web-import — admin web UI, requires admin session
- GET  /api/tasks/web-import/stream — SSE stream of import job progress (admin)
"""

from __future__ import annotations

import asyncio
import json
import logging
from urllib.parse import urlparse

from arq.connections import RedisSettings
from arq.jobs import Job, JobStatus
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth import get_current_admin, require_api_key
from app.config import get_settings
from app.models.admin import Admin
from app.tasks.worker import enqueue_process_image

router = APIRouter()

logger = logging.getLogger(__name__)

settings = get_settings()


def _parse_redis_url(url: str) -> RedisSettings:
    """Parse a redis:// URL into ARQ RedisSettings.

    Same parsing logic as ``app.tasks.worker._parse_redis_url`` /
    ``bot.app.services.arq_client._parse_redis_url`` — kept local to avoid a
    circular import with the worker module.
    """
    parsed = urlparse(url)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        database=int(parsed.path.lstrip("/") or "0"),
        password=parsed.password or None,
    )


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

    urls: list[str] = Field(..., max_length=50, description="List of image URLs to import (max 50)")


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


# ── SSE progress stream for web import ──────────────────────────────────────

# Map ARQ job results to a normalized status string + human-readable detail,
# mirroring the bot's `_poll_and_notify` error mapping so the web UI shows the
# same classifications (success / duplicate / too large / failed).
def _classify_job_result(result: dict) -> tuple[str, str | None, dict]:
    """Classify a finished job's result dict into (status, detail, extra).

    Returns:
        (status, detail, extra) where:
          status  — "success" | "duplicate" | "too_large" | "failed"
          detail  — short Chinese label for the UI row
          extra   — extra fields to forward (e.g. post_id / existing_post_id)
    """
    status = result.get("status")
    if status == "success":
        return ("success", "导入成功", {"post_id": result.get("post_id")})
    if status == "error":
        error = result.get("error")
        if error == "duplicate":
            return (
                "duplicate",
                "重复图片",
                {"existing_post_id": result.get("existing_post_id")},
            )
        if error == "image_too_large":
            return ("too_large", "图片过大", {})
        if error == "download_failed":
            return ("failed", "下载失败", {})
        return ("failed", result.get("message") or "处理失败", {})
    return ("failed", "未知状态", {})


def _sse(event: str, payload: dict) -> str:
    """Format an SSE message block (event + JSON data, terminated by blank line)."""
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _import_progress_generator(task_ids: list[str]):
    """Yield SSE events for the given ARQ job IDs until all finish or timeout.

    Emits one ``progress`` event per job that transitions to a terminal state,
    a ``done`` event with the summary when all jobs are resolved, and periodic
    ``: ping`` heartbeat comments to keep the connection alive through proxies.
    Mirrors the bot's ``poll_job_result`` polling model.
    """
    from arq import create_pool

    redis_settings = _parse_redis_url(settings.REDIS_URL)
    pool = await create_pool(redis_settings)

    try:
        jobs = {i: Job(task_id, redis=pool) for i, task_id in enumerate(task_ids)}
        # index → already-reported (terminal) flag
        reported: dict[int, bool] = {i: False for i in jobs}

        succeeded = 0
        failed = 0

        deadline = asyncio.get_event_loop().time() + 300  # 5 min cap
        poll_interval = 2.0

        while not all(reported.values()):
            if asyncio.get_event_loop().time() >= deadline:
                break

            for idx, job in jobs.items():
                if reported[idx]:
                    continue
                try:
                    status = await job.status()
                except Exception as exc:
                    logger.warning("SSE: status() failed for %s: %s", task_ids[idx], exc)
                    reported[idx] = True
                    failed += 1
                    yield _sse("progress", {
                        "url_index": idx,
                        "task_id": task_ids[idx],
                        "status": "failed",
                        "detail": "状态查询失败",
                    })
                    continue

                if status == JobStatus.not_found:
                    # Job result key is gone (expired/never kept) — treat as failure.
                    reported[idx] = True
                    failed += 1
                    yield _sse("progress", {
                        "url_index": idx,
                        "task_id": task_ids[idx],
                        "status": "failed",
                        "detail": "任务已丢失",
                    })
                elif status == JobStatus.complete:
                    # Fetch the result to classify it. `result_info()` returns a
                    # JobResult without raising/awaiting; fall back to
                    # `result(timeout=...)` for older arq versions or if the
                    # result key isn't where status() saw it.
                    try:
                        result_info = await job.result_info()
                        result = getattr(result_info, "result", None) if result_info else {}
                    except Exception:
                        try:
                            result = await job.result(timeout=0.1)
                        except Exception:
                            result = {}
                    if not isinstance(result, dict):
                        result = {}
                    status_str, detail, extra = _classify_job_result(result)
                    reported[idx] = True
                    if status_str == "success":
                        succeeded += 1
                    else:
                        failed += 1
                    yield _sse("progress", {
                        "url_index": idx,
                        "task_id": task_ids[idx],
                        "status": status_str,
                        "detail": detail,
                        **extra,
                    })

            # Heartbeat keeps the connection alive while jobs are still running.
            yield ": ping\n\n"
            if not all(reported.values()):
                await asyncio.sleep(poll_interval)

        # Any job that never reached a terminal state within the deadline is
        # treated as a timeout failure.
        timed_out = sum(1 for r in reported.values() if not r)
        failed += timed_out

        yield _sse("done", {
            "total": len(task_ids),
            "succeeded": succeeded,
            "failed": failed,
            "timed_out": timed_out,
        })
    except Exception as exc:
        logger.exception("SSE import stream error: %s", exc)
        yield _sse("error", {"message": "导入流异常: " + str(exc)})
    finally:
        await pool.aclose()


@router.get("/web-import/stream")
async def web_import_stream(
    task_ids: str = Query(..., description="Comma-separated ARQ job IDs (max 50)"),
    _admin: Admin = Depends(get_current_admin),
):
    """Stream real-time progress for a batch of web-import ARQ jobs via SSE.

    Admin-only (mirrors POST /web-import). The client connects with
    ``EventSource`` right after enqueuing tasks and receives one ``progress``
    event per job as it finishes, plus a final ``done`` event with tallies.
    """
    ids = [tid.strip() for tid in task_ids.split(",") if tid.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="task_ids is required")
    if len(ids) > 50:
        raise HTTPException(status_code=400, detail="task_ids exceeds max of 50")

    return StreamingResponse(
        _import_progress_generator(ids),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable Nginx/Caddy proxy buffering
        },
    )
