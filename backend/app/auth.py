"""Admin authentication: signed-cookie sessions + API key gating.

This module provides two independent auth mechanisms:

1. **Admin session** — admins are stored in the `admins` DB table. On first
   startup a default admin is auto-created with a random password printed
   to the logs. After that, passwords can be changed from the web UI.
   Login sets a signed cookie (`kura_admin_session`) whose payload is
   `{"sub": "<admin_id>", "iat": <ts>}`.

2. **API key** — a shared secret (`BACKEND_API_KEY`) that trusted internal
   callers (the Telegram bot, future web ingestion) send via the `X-Api-Key`
   header to access mutating endpoints (POST /api/tasks/, POST /api/rebuild/).

Two auth dependency levels:
- `get_is_admin(request)` — lightweight, checks cookie signature only. Used
  for read endpoints that need to decide visibility (show NSFW or not).
- `get_current_admin(request, db)` — heavy, also looks up the Admin row in
  the database. Used for write endpoints (change password, edit rating).
"""

from __future__ import annotations

import hmac
import logging
import secrets
import time
from typing import Optional

import bcrypt
from fastapi import Depends, Header, HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.admin import Admin

logger = logging.getLogger(__name__)

SESSION_COOKIE_NAME = "kura_admin_session"
_SALT = "kura-admin-session"


# ── Signed-cookie helpers ──────────────────────────────────────────────

def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.SECRET_KEY, salt=_SALT)


def sign_session(admin_id: str) -> str:
    """Create a signed session token for the given admin ID."""
    payload = {"sub": admin_id, "iat": int(time.time())}
    return _serializer().dumps(payload)


def verify_session(token: Optional[str]) -> Optional[str]:
    """Verify a session token and return the admin ID, or None."""
    if not token or not settings.SECRET_KEY:
        return None
    try:
        payload = _serializer().loads(
            token, max_age=settings.ADMIN_SESSION_MAX_AGE
        )
    except (BadSignature, SignatureExpired):
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None


def set_session_cookie(response, token: str) -> None:
    """Attach the session cookie to a Starlette/FastAPI Response."""
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=settings.ADMIN_SESSION_MAX_AGE,
        httponly=True,
        secure=bool(settings.APP_URL.startswith("https://")),
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response) -> None:
    """Delete the session cookie.

    Must match the same Secure/SameSite attributes used when setting the cookie,
    otherwise browsers will silently ignore the deletion directive.
    """
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        secure=bool(settings.APP_URL.startswith("https://")),
        httponly=True,
        samesite="lax",
    )


# ── Lightweight auth dependency (cookie-only, no DB lookup) ─────────────

async def get_is_admin(request: Request) -> bool:
    """FastAPI dependency: return True if the request carries a valid admin
    session cookie. Checks signature only — does NOT query the database.
    Suitable for visibility gating (show NSFW or not).
    """
    token = request.cookies.get(SESSION_COOKIE_NAME)
    return verify_session(token) is not None


# ── Heavy auth dependency (cookie + DB lookup) ──────────────────────────

async def get_current_admin(
    request: Request, db: AsyncSession = Depends(get_db)
) -> Admin:
    """FastAPI dependency: return the Admin row for the session cookie.

    Raises 401 if not authenticated. Use this for write endpoints that need
    to identify the admin (change password, etc).
    """
    token = request.cookies.get(SESSION_COOKIE_NAME)
    admin_id = verify_session(token)
    if admin_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    try:
        import uuid
        uid = uuid.UUID(admin_id)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session",
        )
    stmt = select(Admin).where(Admin.id == uid)
    result = await db.execute(stmt)
    admin = result.scalar_one_or_none()
    if admin is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin not found",
        )
    return admin


# ── Database-backed admin verification ──────────────────────────────────

async def verify_admin_login(
    username: str, password: str, db: AsyncSession
) -> Optional[Admin]:
    """Check username + password against the admins table.

    Returns the Admin object on success, or None on failure.
    """
    stmt = select(Admin).where(Admin.username == username)
    result = await db.execute(stmt)
    admin = result.scalar_one_or_none()
    if admin is None:
        return None
    try:
        if bcrypt.checkpw(password.encode("utf-8"), admin.password_hash.encode("utf-8")):
            return admin
    except (ValueError, TypeError):
        pass
    return None


# ── First-startup auto-creation ─────────────────────────────────────────

async def ensure_default_admin(db: AsyncSession) -> None:
    """Create a default admin if the admins table is empty.

    Uses ADMIN_USERNAME and ADMIN_PASSWORD from .env. If ADMIN_PASSWORD is
    empty, falls back to a random password printed to the logs.
    """
    count_stmt = select(Admin)
    result = await db.execute(count_stmt)
    existing = result.scalar_one_or_none()
    if existing is not None:
        return  # Table already has an admin, nothing to do

    username = settings.ADMIN_USERNAME or "admin"
    if settings.ADMIN_PASSWORD:
        raw_password = settings.ADMIN_PASSWORD
        logger.info("Default admin created with configured password")
    else:
        raw_password = secrets.token_urlsafe(16)
        logger.warning("ADMIN_PASSWORD not set — using random password")
    hashed = bcrypt.hashpw(
        raw_password.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")

    admin = Admin(username=username, password_hash=hashed)
    db.add(admin)
    await db.commit()

    # Print in a very visible format so the deployer notices
    logger.warning("=" * 60)
    logger.warning("DEFAULT ADMIN CREATED (first startup)")
    logger.warning("  Username: %s", username)
    logger.warning("  Password: %s", raw_password)
    if not settings.ADMIN_PASSWORD:
        logger.warning("  >>> Set ADMIN_PASSWORD in .env and restart to use a fixed password! <<<")
    else:
        logger.warning("  Password configured via ADMIN_PASSWORD env var")
    logger.warning("=" * 60)


# ── API key (bot ↔ backend) ─────────────────────────────────────────────

def require_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    """Dependency: require a matching X-Api-Key header.

    If BACKEND_API_KEY is unset, the endpoint is left open (preserves current
    dev behavior). When set, callers must send a matching header.
    """
    expected = settings.BACKEND_API_KEY
    if not expected:
        return
    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )