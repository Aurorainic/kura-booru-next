from __future__ import annotations

import logging
import re

from aiogram import Router, F
from aiogram.types import Message
from aiogram.filters import Command

from app.handlers.url_handler import URL_PATTERN, process_url

logger = logging.getLogger(__name__)

router = Router()


@router.message(Command("save"))
@router.message(F.text.regexp(r"^!save\s"))
async def cmd_save(message: Message) -> None:
    """Handle /save or !save command — explicitly save an image URL.

    Usage: /save <url> or !save <url>
    """
    text = message.text or ""

    # Extract the command arguments (everything after /save or !save)
    command_match = re.match(r"^(?:/save|!save)\s+(.+)", text, re.IGNORECASE)
    if not command_match:
        await message.answer(
            "用法 / Usage:\n`/save <url>` or `!save <url>`",
            parse_mode="Markdown",
        )
        return

    remaining = command_match.group(1).strip()

    # Find a URL in the remaining text
    url_match = URL_PATTERN.search(remaining)
    if not url_match:
        await message.answer("⚠️ 未检测到有效 URL / No valid URL detected.")
        return

    url = url_match.group(0)
    await process_url(message, url)
