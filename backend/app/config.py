from __future__ import annotations

from functools import lru_cache
from typing import Tuple

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ── Application ──────────────────────────────────────────────────
    APP_URL: str = ""
    SECRET_KEY: str = ""

    # ── Admin Auth ───────────────────────────────────────────────────
    # Admin credentials for the initial account created on first startup.
    # After login, the admin can change password from the web UI.
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = ""  # REQUIRED in production — no default for security
    ADMIN_SESSION_MAX_AGE: int = 60 * 60 * 24 * 7  # 7 days
    # Shared secret for trusted internal callers (the bot, future web ingestion).
    # When non-empty, POST /api/tasks/ and POST /api/rebuild/ require
    # the header X-Api-Key to match this value.
    BACKEND_API_KEY: str = ""

    # ── S3 Storage ───────────────────────────────────────────────────
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_EXTERNAL_URL: str = "http://localhost:9000/kura-booru"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_BUCKET_NAME: str = "kura-booru"
    S3_REGION: str = "us-east-1"

    # ── Database ─────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://kura:password@localhost:5432/kurabooru"

    # ── Redis ────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Telegram Bot ─────────────────────────────────────────────────
    BOT_TOKEN: str = ""
    BOT_WEBHOOK_URL: str = ""
    BOT_WEBHOOK_SECRET: str = ""
    BOT_ADMIN_IDS: list[int] = []

    @field_validator("BOT_ADMIN_IDS", mode="before")
    @classmethod
    def parse_admin_ids(cls, v: str | int | list[int]) -> list[int]:
        if isinstance(v, int):
            return [v]
        if isinstance(v, str):
            if not v.strip():
                return []
            return [int(x.strip()) for x in v.split(",") if x.strip()]
        return v

    # ── Image Processing ─────────────────────────────────────────────
    MAX_IMAGE_SIZE: int = 6291456  # 6 MB
    THUMB_SIZE: str = "400x400"
    PREVIEW_SIZE: str = "1200x1200"

    @field_validator("THUMB_SIZE", mode="before")
    @classmethod
    def validate_thumb_size(cls, v: str) -> str:
        # Just validate format; parsed tuple is accessed via property
        parts = v.split("x")
        if len(parts) != 2:
            raise ValueError("THUMB_SIZE must be in WxH format, e.g. 150x150")
        return v

    @field_validator("PREVIEW_SIZE", mode="before")
    @classmethod
    def validate_preview_size(cls, v: str) -> str:
        parts = v.split("x")
        if len(parts) != 2:
            raise ValueError("PREVIEW_SIZE must be in WxH format, e.g. 850x850")
        return v

    @property
    def thumb_size_tuple(self) -> Tuple[int, int]:
        w, h = self.THUMB_SIZE.split("x")
        return (int(w), int(h))

    @property
    def preview_size_tuple(self) -> Tuple[int, int]:
        w, h = self.PREVIEW_SIZE.split("x")
        return (int(w), int(h))

    # ── gallery-dl Authentication ────────────────────────────────────
    PIXIV_REFRESH_TOKEN: str = ""
    PIXIV_PHPSESSID: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance — call once, reuse everywhere."""
    return Settings()


# Module-level singleton for convenient import
settings = get_settings()