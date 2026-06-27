from __future__ import annotations

import logging

from aiogram import Router, F
from aiogram.types import Message
from aiogram.filters import Command

from app.services.backend_api import get_random_post
from app.handlers.info import format_post_info
from app.i18n import t, get_chat_lang

logger = logging.getLogger(__name__)

router = Router()


@router.message(Command("random"))
@router.message(F.text.regexp(r"^!random"))
async def cmd_random(message: Message) -> None:
    """Handle /random or !random — show a random post."""
    lang = await get_chat_lang(message.chat.id)
    post = await get_random_post()
    if post is None:
        await message.answer(t("random_no_posts", lang))
        return

    text = format_post_info(post)
    await message.answer(text, parse_mode="Markdown")
