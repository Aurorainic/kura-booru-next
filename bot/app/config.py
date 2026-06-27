from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    BOT_TOKEN: str
    BOT_WEBHOOK_URL: str
    BOT_WEBHOOK_SECRET: str
    BOT_ADMIN_IDS: list[int]
    FRONTEND_URL: str = ""  # Required — must be HTTPS for Telegram inline buttons
    BOT_PORT: int = 8080
    BACKEND_API_URL: str = ""  # Required — e.g. http://backend:8000 (Docker) or http://<internal-host>:8000 (Zeabur)
    # Shared secret sent as X-Api-Key to the backend on every request. Required
    # now that POST /api/tasks/ and POST /api/rebuild/ are gated by it.
    BACKEND_API_KEY: str = ""
    REDIS_URL: str = "redis://redis:6379/0"
    # When true, skip rating selection UI — auto-confirm as safe immediately.
    # Set via /autopass on/off in chat, stored in Redis.
    BOT_AUTOPASS_DEFAULT: bool = False

    @field_validator("FRONTEND_URL", mode="after")
    @classmethod
    def validate_frontend_url(cls, v: str) -> str:
        if not v:
            raise ValueError("FRONTEND_URL is required (e.g. https://kura-booru.lainns.xyz)")
        return v

    @field_validator("BACKEND_API_URL", mode="after")
    @classmethod
    def validate_backend_api_url(cls, v: str) -> str:
        if not v:
            raise ValueError("BACKEND_API_URL is required (e.g. http://backend:8000)")
        return v

    @field_validator("BOT_ADMIN_IDS", mode="before")
    @classmethod
    def parse_admin_ids(cls, v: str | int | list[int]) -> list[int]:
        """Parse comma-separated admin IDs from env."""
        if isinstance(v, list):
            return v
        if isinstance(v, int):
            return [v]
        return [int(x.strip()) for x in v.split(",") if x.strip()]


settings = Settings()