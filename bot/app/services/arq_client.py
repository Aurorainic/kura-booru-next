from __future__ import annotations

import asyncio
import logging
from typing import Any

from arq import create_pool
from arq.connections import RedisSettings, ArqRedis
from arq.jobs import Job

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
    password = parsed.password or None

    return RedisSettings(host=host, port=port, database=database, password=password)


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


async def poll_job_result(
    task_id: str,
    *,
    timeout: int = 300,
    poll_delay: float = 3.0,
) -> dict[str, Any] | None:
    """Poll an ARQ job until it completes or times out.

    Args:
        task_id: The ARQ job ID.
        timeout: Maximum seconds to wait for completion.
        poll_delay: Seconds between status checks.

    Returns:
        The job result dict, or None on timeout/failure.
    """
    pool = await get_arq_pool()
    job = Job(task_id, redis=pool)
    try:
        result = await job.result(timeout=timeout, poll_delay=poll_delay)
        logger.info("Job %s completed with result: %s", task_id, result)
        return result
    except Exception as exc:
        logger.warning("Job %s polling failed: %s", task_id, exc)
        return None