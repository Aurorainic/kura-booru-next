from __future__ import annotations

import logging
import re

from aiogram import Router, F
from aiogram.types import Message

from app.services.backend_api import create_process_task

logger = logging.getLogger(__name__)

router = Router()

# URL detection pattern — matches http(s) URLs in message text
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)

# Source site detection patterns mapped to (site_name, id_capture_group)
SOURCE_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Pixiv: https://www.pixiv.net/artworks/12345678
    (
        re.compile(
            r"(?:https?://)?(?:www\.)?pixiv\.net/(?:artworks|illust)/(\d+)",
            re.IGNORECASE,
        ),
        "pixiv",
    ),
    # Pixiv short: https://pixiv.net/i/12345678
    (
        re.compile(
            r"(?:https?://)?(?:www\.)?pixiv\.net/i/(\d+)",
            re.IGNORECASE,
        ),
        "pixiv",
    ),
    # Twitter/X: https://twitter.com/user/status/12345 or https://x.com/user/status/12345
    (
        re.compile(
            r"(?:https?://)?(?:www\.)?(?:twitter\.com|x\.com)/\w+/status/(\d+)",
            re.IGNORECASE,
        ),
        "twitter",
    ),
    # Danbooru: https://danbooru.donmai.us/posts/12345
    (
        re.compile(
            r"(?:https?://)?(?:www\.)?danbooru\.donmai\.us/posts/(\d+)",
            re.IGNORECASE,
        ),
        "danbooru",
    ),
]


def identify_source(url: str) -> tuple[str, str] | None:
    """Identify the source site and extract the source ID from a URL.

    Returns (source_site, source_id) or None if not recognized.
    """
    for pattern, site_name in SOURCE_PATTERNS:
        match = pattern.search(url)
        if match:
            return site_name, match.group(1)

    # Unknown source — still processable
    return "other", url


@router.message(F.text, ~F.text.startswith("/"), ~F.text.startswith("!"))
async def handle_url_message(message: Message) -> None:
    """Handle messages that contain URLs (not commands).

    Detects URLs in the message text, identifies the source, and dispatches
    a processing task to the backend.
    """
    text = message.text or ""
    url_match = URL_PATTERN.search(text)

    if not url_match:
        return  # No URL found, ignore

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

    # Edit the processing message to acknowledge receipt
    task_id = result.get("task_id", "unknown")
    await processing_msg.edit_text(
        f"📥 已加入队列 / Queued for processing\n"
        f"Source: {source_site} | ID: {source_id}\n"
        f"Task: `{task_id}`",
        parse_mode="Markdown",
    )