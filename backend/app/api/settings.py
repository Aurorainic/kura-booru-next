"""REST API routes for site settings.

Provides admin CRUD for all settings, a public endpoint for non-sensitive
settings, and connectivity test endpoints for PG/Redis URLs.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_admin
from app.database import get_db
from app.models.admin import Admin
from app.services.settings import (
    _PUBLIC_KEYS,
    get_all_settings,
    seed_settings_from_env,
    test_pg_connectivity,
    test_redis_connectivity,
    update_settings,
)

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────


class SettingRead(BaseModel):
    key: str
    value: str
    updated_at: str  # ISO format


class SettingsResponse(BaseModel):
    settings: list[SettingRead]


class SettingsUpdate(BaseModel):
    settings: dict[str, str]  # key → new value


class ConnectivityTestRequest(BaseModel):
    url: str


class ConnectivityTestResponse(BaseModel):
    ok: bool
    detail: str


class PublicSettingsResponse(BaseModel):
    site_title: str
    site_description: str
    announcement: str
    head_inject: str


# ── Endpoints ────────────────────────────────────────────────────────


@router.get("/", response_model=SettingsResponse)
async def list_settings(
    db: AsyncSession = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    """List all settings (admin only, includes infrastructure URLs)."""
    from app.models.setting import Setting

    all_settings = await get_all_settings(db)
    # Fetch updated_at from DB for each key
    from sqlalchemy import select

    result = await db.execute(select(Setting).order_by(Setting.key))
    rows = result.scalars().all()

    return SettingsResponse(
        settings=[
            SettingRead(
                key=row.key,
                value=row.value,
                updated_at=row.updated_at.isoformat(),
            )
            for row in rows
        ]
    )


@router.put("/", response_model=SettingsResponse)
async def update_settings_endpoint(
    body: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    """Batch update settings (admin only)."""
    from app.models.setting import Setting
    from sqlalchemy import select

    await update_settings(db, body.settings)

    # Return updated list
    result = await db.execute(select(Setting).order_by(Setting.key))
    rows = result.scalars().all()

    return SettingsResponse(
        settings=[
            SettingRead(
                key=row.key,
                value=row.value,
                updated_at=row.updated_at.isoformat(),
            )
            for row in rows
        ]
    )


@router.get("/public", response_model=PublicSettingsResponse)
async def public_settings(
    db: AsyncSession = Depends(get_db),
):
    """Get non-sensitive settings (no auth required).

    Returns only site_title, site_description, announcement, head_inject.
    Never exposes database_url or redis_url.
    """
    all_settings = await get_all_settings(db)
    return PublicSettingsResponse(
        site_title=all_settings.get("site_title", "Kura Booru"),
        site_description=all_settings.get("site_description", "个人动漫插画收藏与展示平台"),
        announcement=all_settings.get("announcement", ""),
        head_inject=all_settings.get("head_inject", ""),
    )


@router.post("/test-pg", response_model=ConnectivityTestResponse)
async def test_pg(
    body: ConnectivityTestRequest,
    admin: Admin = Depends(get_current_admin),
):
    """Test PostgreSQL connectivity with a temporary engine (admin only)."""
    result = await test_pg_connectivity(body.url)
    return ConnectivityTestResponse(**result)


@router.post("/test-redis", response_model=ConnectivityTestResponse)
async def test_redis(
    body: ConnectivityTestRequest,
    admin: Admin = Depends(get_current_admin),
):
    """Test Redis connectivity with a temporary client (admin only)."""
    result = await test_redis_connectivity(body.url)
    return ConnectivityTestResponse(**result)
