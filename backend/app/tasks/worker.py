"""ARQ worker setup.

Configures the Redis connection and registers all task functions.
The worker is started via ``arq app.tasks.worker.WorkerSettings``.
"""

from __future__ import annotations

import logging
from typing import Any

from arq import cron, create_pool
from arq.connections import RedisSettings
from sqlalchemy import text

from app.config import get_settings
from app.services.gallery_dl import setup_gallery_dl_config
from app.tasks.process_image import process_image, reprocess_tags

logger = logging.getLogger(__name__)

settings = get_settings()


def _parse_redis_url(url: str) -> RedisSettings:
    """Parse a Redis URL into ARQ RedisSettings.

    Accepts URLs like: redis://localhost:6379/0
    """
    from urllib.parse import urlparse

    parsed = urlparse(url)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        database=int(parsed.path.lstrip("/") or "0"),
        password=parsed.password or None,
    )


async def sync_tag_post_counts(ctx: dict) -> dict[str, Any]:
    """Recalculate tag post_count from post_tags (single-source-of-truth sync).

    Runs as an ARQ cron job. Corrects drift from +=1 / -=1 in _ensure_tags
    and delete_post that can accumulate on errors or retries.
    """
    from app.database import async_session_factory

    async with async_session_factory() as db:
        result = await db.execute(text(
            "UPDATE tags SET post_count = ("
            "  SELECT COUNT(*) FROM post_tags WHERE post_tags.tag_id = tags.id"
            ")"
        ))
        await db.commit()
        logger.info("sync_tag_post_counts: updated %d tags", result.rowcount)
        return {"rows_updated": result.rowcount}


# ARQ worker settings class — used by ``arq`` CLI to configure the worker
class WorkerSettings:
    """ARQ worker settings.

    Start the worker with:
        arq app.tasks.worker.WorkerSettings
    """

    redis_settings = _parse_redis_url(settings.REDIS_URL)

    # Register all task functions here
    functions = [process_image, reprocess_tags]

    # Periodic maintenance: recalculate tag post_count from post_tags truth
    cron_jobs = [cron(sync_tag_post_counts, minute=7, run_at_startup=True)]

    # Worker startup hook
    @staticmethod
    async def on_startup(ctx):
        setup_gallery_dl_config()

    # Worker timeouts
    job_timeout = 300  # 5 minutes per job
    keep_result = 3600  # Keep results for 1 hour
    max_tries = 3  # Retry failed jobs up to 3 times


async def enqueue_process_image(source_url: str, source_site: str | None = None, source_id: str | None = None) -> str:
    """Enqueue an image processing task to the ARQ worker.

    Args:
        source_url: The URL to process.
        source_site: Optional pre-resolved source site.
        source_id: Optional pre-resolved source ID.

    Returns:
        The task/job ID.
    """
    redis_settings = _parse_redis_url(settings.REDIS_URL)
    pool = await create_pool(redis_settings)

    job = await pool.enqueue_job(
        "process_image",
        source_url=source_url,
        source_site=source_site,
        source_id=source_id,
    )

    await pool.aclose()
    logger.info("Enqueued process_image task %s for URL: %s", job.job_id, source_url)
    return job.job_id
