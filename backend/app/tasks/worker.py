"""ARQ worker setup.

Configures the Redis connection and registers all task functions.
The worker is started via ``arq app.tasks.worker.WorkerSettings``.
"""

from __future__ import annotations

import logging

from arq import create_pool
from arq.connections import RedisSettings

from app.config import get_settings
from app.tasks.process_image import process_image

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


# ARQ worker settings class — used by ``arq`` CLI to configure the worker
class WorkerSettings:
    """ARQ worker settings.

    Start the worker with:
        arq app.tasks.worker.WorkerSettings
    """

    redis_settings = _parse_redis_url(settings.REDIS_URL)

    # Register all task functions here
    functions = [process_image]

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