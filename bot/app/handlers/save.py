from __future__ import annotations

import asyncio
import logging
import re

from aiogram import Router, F
from aiogram.types import Message
from aiogram.filters import Command

from app.handlers.url_handler import URL_PATTERN, _dispatch_and_poll
from app.i18n import t, get_chat_lang

logger = logging.getLogger(__name__)

router = Router()


@router.message(Command("save"))
@router.message(F.text.regexp(r"^!save\s"))
async def cmd_save(message: Message) -> None:
    """Handle /save or !save command — explicitly save an image URL."""
    text = message.text or ""
    lang = await get_chat_lang(message.chat.id)

    command_match = re.match(r"^(?:/save|!save)\s+(.+)", text, re.IGNORECASE)
    if not command_match:
        await message.answer(t("save_usage", lang), parse_mode="Markdown")
        return

    remaining = command_match.group(1).strip()

    url_match = URL_PATTERN.search(remaining)
    if not url_match:
        await message.answer("⚠️ 未检测到有效 URL / No valid URL detected.")
        return

    url = url_match.group(0)
    asyncio.create_task(_dispatch_and_poll(message, url))
