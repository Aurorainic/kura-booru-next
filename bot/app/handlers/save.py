from __future__ import annotations

import logging
import re

from aiogram import Router, F
from aiogram.types import Message
from aiogram.filters import Command

from app.handlers.url_handler import URL_PATTERN, identify_source
from app.services.backend_api import create_process_task

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
    # Handle both /save <url> and !save <url>
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
    source_info = identify_source(url)

    if source_info is None:
        await message.answer("⚠️ 无法识别此链接的来源 / Unsupported URL source.")
        return

    source_site, source_id = source_info

    # Send "processing" reply
    processing_msg = await message.reply("⏳ 正在下载... / Downloading...")

    # Dispatch to backend
    result = await create_process_task(
        source_url=url,
        source_site=source_site,
        source_id=source_id,
    )

    if result is None:
        await processing_msg.edit_text(
            "❌ 下载失败 / Failed to create processing task.\n"
            "Please try again later."
        )
        return

    task_id = result.get("task_id", "unknown")
    await processing_msg.edit_text(
        f"📥 已加入队列 / Queued for processing\n"
        f"Source: {source_site} | ID: {source_id}\n"
        f"Task: `{task_id}`",
        parse_mode="Markdown",
    )