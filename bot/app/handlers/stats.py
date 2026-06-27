from __future__ import annotations

import logging

from aiogram import Router, F
from aiogram.types import Message
from aiogram.filters import Command

from app.services.backend_api import get_dashboard_stats

logger = logging.getLogger(__name__)

router = Router()


@router.message(Command("stats"))
@router.message(F.text.regexp(r"^!stats"))
async def cmd_stats(message: Message) -> None:
    """Handle /stats or !stats — show gallery statistics."""
    stats = await get_dashboard_stats()
    if stats is None:
        await message.answer("❌ 获取统计信息失败 / Failed to fetch stats.")
        return

    overview = stats.get("overview", {})
    total_posts = overview.get("total_posts", 0)
    total_tags = overview.get("total_tags", 0)
    total_post_tags = overview.get("total_post_tags", 0)
    total_size = overview.get("total_file_size_bytes", 0)

    # Format file size
    if total_size >= 1_000_000_000:
        size_str = f"{total_size / 1_000_000_000:.1f} GB"
    elif total_size >= 1_000_000:
        size_str = f"{total_size / 1_000_000:.1f} MB"
    else:
        size_str = f"{total_size / 1_000:.1f} KB"

    text = (
        "📊 **Kura Booru Stats**\n"
        f"🖼 Posts: {total_posts}\n"
        f"🏷 Tags: {total_tags}\n"
        f"🔗 Tag links: {total_post_tags}\n"
        f"💾 Storage: {size_str}"
    )
    await message.answer(text, parse_mode="Markdown")
