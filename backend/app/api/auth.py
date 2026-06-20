"""Admin authentication endpoints.

Login/logout/status for the admin session that unlocks NSFW visibility.
Change-password for updating credentials after first login.
"""

from __future__ import annotations

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    clear_session_cookie,
    get_current_admin,
    get_is_admin,
    set_session_cookie,
    sign_session,
    verify_admin_login,
)
from app.database import get_db
from app.models.admin import Admin

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class StatusResponse(BaseModel):
    is_admin: bool


class LoginResponse(BaseModel):
    ok: bool
    is_admin: bool = True


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.get("/status", response_model=StatusResponse)
async def auth_status(is_admin: bool = Depends(get_is_admin)):
    """Return whether the current request carries a valid admin session."""
    return StatusResponse(is_admin=is_admin)


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Validate credentials against the admins table and set a signed session cookie."""
    admin = await verify_admin_login(body.username, body.password, db)
    if admin is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    token = sign_session(str(admin.id))
    response = JSONResponse(content=LoginResponse(ok=True).model_dump())
    set_session_cookie(response, token)
    return response


@router.post("/logout")
async def logout():
    """Clear the session cookie."""
    response = JSONResponse(content={"ok": True})
    clear_session_cookie(response)
    return response


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    admin: Admin = Depends(get_current_admin),
):
    """Change the admin password. Requires a valid admin session."""
    if len(body.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 6 characters",
        )
    # Verify current password
    try:
        if not bcrypt.checkpw(
            body.current_password.encode("utf-8"),
            admin.password_hash.encode("utf-8"),
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect",
            )
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    # Update password
    admin.password_hash = bcrypt.hashpw(
        body.new_password.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")
    return {"ok": True}