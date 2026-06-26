"""Site settings service layer.

Provides Redis-cached access to the settings key-value table.
All settings are stored in a single Redis hash key `kura:settings`
for efficient bulk reads. TTL is 300s.

Connectivity tests for PG/Redis use temporary connections that are
destroyed after the test — they never touch the running engine/client.
"""

from __future__ import annotations

import logging
from typing import Optional

import redis.asyncio as aioredis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.auth import _get_redis
from app.config import settings as app_settings
from app.models.setting import Setting

logger = logging.getLogger(__name__)

_REDIS_HASH_KEY = "kura:settings"
_CACHE_TTL = 300  # seconds

# Default values for all known settings keys
_SETTING_DEFAULTS: dict[str, str] = {
    "site_title": "Kura Booru",
    "site_description": "个人动漫插画收藏与展示平台",
    "announcement": "",
    "head_inject": "",
    "maintenance_mode": "false",  # "true" | "false"
    "database_url": "",  # filled from env at seed time
    "redis_url": "",  # filled from env at seed time
}

# Keys that are safe to expose publicly (no infrastructure secrets)
_PUBLIC_KEYS = {"site_title", "site_description", "announcement", "head_inject", "maintenance_mode"}


async def get_all_settings(db: AsyncSession) -> dict[str, str]:
    """Load all settings. Redis first, DB fallback, cache on miss."""
    redis = await _get_redis()
    cached = await redis.hgetall(_REDIS_HASH_KEY)
    if cached:
        # redis returns bytes keys — decode
        return {k.decode() if isinstance(k, bytes) else k: v.decode() if isinstance(v, bytes) else v for k, v in cached.items()}

    # Cache miss — load from DB
    result = await db.execute(text("SELECT key, value FROM settings"))
    rows = result.fetchall()
    data = {row[0]: row[1] for row in rows}

    # Fill cache
    if data:
        await redis.hset(_REDIS_HASH_KEY, mapping=data)  # type: ignore[arg-type]
        await redis.expire(_REDIS_HASH_KEY, _CACHE_TTL)

    return data


async def get_setting(db: AsyncSession, key: str, default: str = "") -> str:
    """Get a single setting value by key."""
    all_settings = await get_all_settings(db)
    return all_settings.get(key, default)


async def update_settings(db: AsyncSession, updates: dict[str, str]) -> dict[str, str]:
    """Batch update settings using INSERT ... ON CONFLICT DO UPDATE upsert.

    Refreshes Redis cache after update.
    """
    for key, value in updates.items():
        await db.execute(
            text(
                "INSERT INTO settings (key, value) VALUES (:key, :value) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
            ),
            {"key": key, "value": value},
        )
    await db.flush()

    # Refresh Redis cache
    redis = await _get_redis()
    result = await db.execute(text("SELECT key, value FROM settings"))
    rows = result.fetchall()
    data = {row[0]: row[1] for row in rows}
    await redis.hset(_REDIS_HASH_KEY, mapping=data)  # type: ignore[arg-type]
    await redis.expire(_REDIS_HASH_KEY, _CACHE_TTL)

    return data


async def test_pg_connectivity(url: str) -> dict:
    """Test PG connectivity with a temporary engine. Never touches the running engine."""
    engine = None
    try:
        engine = create_async_engine(url, pool_size=1, pool_pre_ping=True)
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"ok": True, "detail": "Connected"}
    except Exception as e:
        return {"ok": False, "detail": str(e)}
    finally:
        if engine:
            await engine.dispose()


async def test_redis_connectivity(url: str) -> dict:
    """Test Redis connectivity with a temporary client. Never touches the running client."""
    client = None
    try:
        client = aioredis.from_url(url)
        await client.ping()
        return {"ok": True, "detail": "Connected"}
    except Exception as e:
        return {"ok": False, "detail": str(e)}
    finally:
        if client:
            await client.aclose()


async def seed_settings_from_env(db: AsyncSession) -> None:
    """Seed settings from environment variables for keys that don't exist in DB yet.

    Uses INSERT ... ON CONFLICT DO NOTHING so existing values are never overwritten.
    Called once at startup.
    """
    # Build defaults with env-derived values
    defaults = dict(_SETTING_DEFAULTS)
    defaults["database_url"] = app_settings.DATABASE_URL
    defaults["redis_url"] = app_settings.REDIS_URL

    for key, value in defaults.items():
        await db.execute(
            text(
                "INSERT INTO settings (key, value) VALUES (:key, :value) "
                "ON CONFLICT (key) DO NOTHING"
            ),
            {"key": key, "value": value},
        )
    await db.flush()

    # Warm the Redis cache
    redis = await _get_redis()
    result = await db.execute(text("SELECT key, value FROM settings"))
    rows = result.fetchall()
    data = {row[0]: row[1] for row in rows}
    await redis.hset(_REDIS_HASH_KEY, mapping=data)  # type: ignore[arg-type]
    await redis.expire(_REDIS_HASH_KEY, _CACHE_TTL)

    logger.info("Settings seeded from env (existing keys preserved)")
