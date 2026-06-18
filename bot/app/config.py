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
    BACKEND_API_URL: str = "http://backend:8000"
    REDIS_URL: str = "redis://redis:6379/0"

    @field_validator("BOT_ADMIN_IDS", mode="before")
    @classmethod
    def parse_admin_ids(cls, v: str | list[int]) -> list[int]:
        """Parse comma-separated admin IDs from env."""
        if isinstance(v, list):
            return v
        return [int(x.strip()) for x in v.split(",") if x.strip()]


settings = Settings()