from __future__ import annotations

import logging
import re

from aiogram import Router, F
from aiogram.types import Message
from aiogram.filters import Command

from app.handlers.url_handler import URL_PATTERN, identify_source

logger = logging.getLogger(__name__)

router = Router()


def format_post_info(post: dict) -> str:
    """Format a post dict into a readable info message."""
    lines = [
        "📋 **Post Details**",
        f"**ID:** `{post.get('id', 'N/A')}`",
    ]

    title = post.get("title")
    if title:
        lines.append(f"**Title:** {title}")

    source_url = post.get("source_url")
    if source_url:
        lines.append(f"**Source:** {source_url}")

    source_site = post.get("source_site")
    source_id = post.get("source_id")
    if source_site or source_id:
        lines.append(f"**Site:** {source_site or 'N/A'} | **ID:** `{source_id or 'N/A'}`")

    width = post.get("width")
    height = post.get("height")
    if width and height:
        lines.append(f"**Dimensions:** {width}×{height}")

    file_size = post.get("file_size")
    if file_size:
        if file_size >= 1_000_000:
            size_str = f"{file_size / 1_000_000:.1f} MB"
        else:
            size_str = f"{file_size / 1_000:.1f} KB"
        lines.append(f"**File size:** {size_str}")

    mime_type = post.get("mime_type")
    if mime_type:
        lines.append(f"**Type:** {mime_type}")

    tags = post.get("tags", [])
    if tags:
        tag_names = [t.get("name", "") for t in tags if t.get("name")]
        if tag_names:
            tag_str = " ".join(f"`{t}`" for t in tag_names[:20])
            if len(tag_names) > 20:
                tag_str += f" ... (+{len(tag_names) - 20} more)"
            lines.append(f"**Tags:** {tag_str}")

    created_at = post.get("created_at")
    if created_at:
        lines.append(f"**Added:** {created_at}")

    text = "\n".join(lines)
    # Telegram message limit is 4096 chars; truncate to be safe
    if len(text) > 4000:
        text = text[:3990] + "\n..."
    return text


@router.message(Command("info"))
@router.message(F.text.regexp(r"^!info"))
async def cmd_info(message: Message) -> None:
    """Handle /info or !info command — show post details.

    Can be used in two ways:
    1. Reply to a message that contains a URL or saved image
    2. /info <url> — provide a URL directly
    """
    text = message.text or ""

    # Try to find a URL in the command arguments
    command_match = re.match(r"^(?:/info|!info)\s*(.*)", text, re.IGNORECASE)
    url = None

    if command_match:
        remaining = command_match.group(1).strip()
        url_match = URL_PATTERN.search(remaining) if remaining else None
        if url_match:
            url = url_match.group(0)

    # If no URL in command, check if this is a reply to another message
    if url is None and message.reply_to_message:
        reply_text = message.reply_to_message.text or message.reply_to_message.caption or ""
        url_match = URL_PATTERN.search(reply_text)
        if url_match:
            url = url_match.group(0)

    if url is None:
        await message.answer(
            "用法 / Usage:\n"
            "• `/info <url>` — Get info for a URL\n"
            "• Reply to a message with `/info` — Get info for the URL in that message",
            parse_mode="Markdown",
        )
        return

    # Identify the source to look up the post
    source_info = identify_source(url)

    # Try to find the post by source
    # The backend should support lookup by source_site + source_id
    # For now, we use the source_id as a lookup key
    if source_info is None:
        await message.answer("⚠️ 无法识别此链接 / Cannot identify this URL source.")
        return

    source_site, source_id = source_info

    # Try fetching from backend by source site + source ID
    from app.services.backend_api import get_post_by_source

    post = await get_post_by_source(source_site, source_id)

    if post is None:
        await message.answer(
            f"🔍 未找到此图片 / Post not found.\n"
            f"Source: {source_site} | ID: {source_id}"
        )
        return

    info_text = format_post_info(post)
    await message.answer(info_text, parse_mode="Markdown")