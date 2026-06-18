from __future__ import annotations

from aiogram import BaseMiddleware
from aiogram.types import Message, CallbackQuery

from app.config import settings


class AuthMiddleware(BaseMiddleware):
    """Global middleware that rejects messages from unauthorized users."""

    async def __call__(self, handler, event: Message | CallbackQuery, data: dict):
        user_id: int | None = None

        if isinstance(event, Message):
            user_id = event.from_user.id if event.from_user else None
        elif isinstance(event, CallbackQuery):
            user_id = event.from_user.id if event.from_user else None

        if user_id is None or user_id not in settings.BOT_ADMIN_IDS:
            if isinstance(event, Message):
                await event.answer(
                    "🚫 このボットは許可されたユーザーのみ利用できます。\n"
                    "Unauthorized: this bot is for authorized users only."
                )
            elif isinstance(event, CallbackQuery):
                await event.answer(
                    "🚫 Unauthorized.",
                    show_alert=True,
                )
            return  # Don't propagate to handlers

        return await handler(event, data)