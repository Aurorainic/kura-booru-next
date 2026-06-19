from __future__ import annotations

import asyncio
import logging
import re

from aiogram import Router, F
from aiogram.types import Message

from app.config import settings
from app.services.backend_api import create_process_task, get_post
from app.services.arq_client import poll_job_result

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
    # phixiv.net proxy → normalize to pixiv
    (
        re.compile(
            r"(?:https?://)?(?:www\.)?phixiv\.net/(?:artworks|illust)/(\d+)",
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
    Also normalizes proxy URLs (e.g. phixiv.net → pixiv.net).
    """
    # Normalize phixiv.net proxy URLs back to pixiv.net
    normalized = re.sub(
        r"https?://(?:www\.)?phixiv\.net",
        "https://www.pixiv.net",
        url,
        flags=re.IGNORECASE,
    )

    for pattern, site_name in SOURCE_PATTERNS:
        match = pattern.search(normalized)
        if match:
            return site_name, match.group(1)

    # Unknown source — still processable
    return "other", url


async def _poll_and_notify(
    message: Message,
    processing_msg: Message,
    task_id: str,
    source_site: str,
    source_id: str,
) -> None:
    """Background task: poll ARQ job and edit message on completion."""
    result = await poll_job_result(task_id, timeout=300, poll_delay=3)

    if result is None:
        await processing_msg.edit_text(
            "⏰ 处理超时 / Processing timed out\n"
            f"Task: `{task_id}`",
            parse_mode="Markdown",
        )
        return

    status = result.get("status")
    if status == "success":
        post_id = result.get("post_id")
        # Fetch the post to get the S3 URL
        post = await get_post(post_id) if post_id else None
        if post:
            post_url = f"{settings.FRONTEND_URL}/posts/{post_id}"
            await processing_msg.edit_text(
                f"✅ 处理完成 / Processing complete\n"
                f"Source: {source_site} | ID: {source_id}\n"
                f"[查看作品 / View]({post_url})",
                parse_mode="Markdown",
            )
        else:
            await processing_msg.edit_text(
                f"✅ 处理完成 / Processing complete\n"
                f"Source: {source_site} | ID: {source_id}\n"
                f"Post ID: `{post_id}`",
                parse_mode="Markdown",
            )
    elif status == "error":
        error = result.get("error", "unknown")
        msg = result.get("message", "Unknown error")
        if error == "image_too_large":
            await processing_msg.edit_text(
                f"⚠️ 图片过大 / Image too large\n"
                f"{msg}\n"
                f"Task: `{task_id}`",
                parse_mode="Markdown",
            )
        elif error == "duplicate":
            existing_id = result.get("existing_post_id")
            post_url = f"{settings.FRONTEND_URL}/posts/{existing_id}" if existing_id else None
            if post_url:
                await processing_msg.edit_text(
                    f"⚠️ 重复图片 / Duplicate image\n"
                    f"[查看已有作品 / View existing]({post_url})",
                    parse_mode="Markdown",
                )
            else:
                await processing_msg.edit_text(
                    f"⚠️ 重复图片 / Duplicate image\n"
                    f"Task: `{task_id}`",
                    parse_mode="Markdown",
                )
        else:
            await processing_msg.edit_text(
                f"❌ 处理失败 / Processing failed\n"
                f"Error: `{error}`\n"
                f"{msg}\n"
                f"Task: `{task_id}`",
                parse_mode="Markdown",
            )
    else:
        await processing_msg.edit_text(
            f"⚠️ 未知状态 / Unknown status: `{status}`\n"
            f"Task: `{task_id}`",
            parse_mode="Markdown",
        )


async def process_url(message: Message, url: str) -> None:
    """Shared URL processing: identify source, dispatch task, poll and notify."""
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

    # Start background polling
    task_id = result.get("task_id", "unknown")
    await processing_msg.edit_text(
        f"📥 已加入队列 / Queued for processing\n"
        f"Source: {source_site} | ID: {source_id}\n"
        f"Task: `{task_id}`\n"
        f"⏳ 正在处理中...",
        parse_mode="Markdown",
    )

    # Fire-and-forget background polling
    asyncio.create_task(
        _poll_and_notify(message, processing_msg, task_id, source_site, source_id)
    )


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
    await process_url(message, url)