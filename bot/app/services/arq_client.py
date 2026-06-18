from __future__ import annotations

import logging
from typing import Any

from arq import create_pool
from arq.connections import RedisSettings, ArqRedis

from app.config import settings

logger = logging.getLogger(__name__)

_pool: ArqRedis | None = None


def _parse_redis_url(url: str) -> RedisSettings:
    """Parse a redis:// URL into ARQ RedisSettings."""
    from urllib.parse import urlparse

    parsed = urlparse(url)
    host = parsed.hostname or "redis"
    port = parsed.port or 6379
    database = int(parsed.path.lstrip("/") or "0")

    return RedisSettings(host=host, port=port, database=database)


async def get_arq_pool() -> ArqRedis:
    """Get or create the ARQ connection pool."""
    global _pool
    if _pool is None:
        redis_settings = _parse_redis_url(settings.REDIS_URL)
        _pool = await create_pool(redis_settings)
        logger.info("ARQ pool created, connected to Redis at %s", settings.REDIS_URL)
    return _pool


async def close_arq_pool() -> None:
    """Close the ARQ connection pool on shutdown."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("ARQ pool closed")


async def enqueue_process_image(
    source_url: str,
    source_site: str | None = None,
    source_id: str | None = None,
) -> str:
    """Enqueue an image processing task via ARQ.

    Matches the backend's process_image task signature which accepts
    source_url, source_site, and source_id.

    Returns the job ID.
    """
    pool = await get_arq_pool()
    job = await pool.enqueue_job(
        "process_image",
        source_url=source_url,
        source_site=source_site,
        source_id=source_id,
    )
    logger.info("Enqueued process_image job %s for %s", job, source_url)
    return job.job_id