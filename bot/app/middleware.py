from __future__ import annotations

import logging

from aiogram import BaseMiddleware
from aiogram.types import Message, CallbackQuery

from app.config import settings

logger = logging.getLogger(__name__)


class AuthMiddleware(BaseMiddleware):
    """Global middleware that rejects messages from unauthorized users."""

    async def __call__(self, handler, event: Message | CallbackQuery, data: dict):
        user_id: int | None = None

        if isinstance(event, Message):
            # Prefer from_user.id (the sender), fallback to chat.id (channel/group)
            if event.from_user:
                user_id = event.from_user.id
            elif event.chat:
                user_id = event.chat.id
        elif isinstance(event, CallbackQuery):
            if event.from_user:
                user_id = event.from_user.id

        if user_id is None or user_id not in settings.BOT_ADMIN_IDS:
            logger.warning(
                "Unauthorized access attempt: user_id=%s, event_type=%s, admin_ids=%s",
                user_id,
                type(event).__name__,
                settings.BOT_ADMIN_IDS,
            )
            if isinstance(event, Message):
                await event.answer(
                    "🚫 このボットは許可されたユーザーのみ利用できます。\n"
                    "Unauthorized: this bot is for authorized users only.\n"
                    f"Your ID: {user_id}"
                )
            elif isinstance(event, CallbackQuery):
                await event.answer(
                    "🚫 Unauthorized.",
                    show_alert=True,
                )
            return  # Don't propagate to handlers

        return await handler(event, data)