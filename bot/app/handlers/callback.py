from __future__ import annotations

import logging

from aiogram import Router, F
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton

from app.config import settings
from app.handlers.info import format_post_info
from app.handlers.url_handler import _confirmed_posts
from app.services.backend_api import get_post, update_post_rating

logger = logging.getLogger(__name__)

router = Router()


@router.callback_query(F.data.startswith("rate:"))
async def callback_rate_post(callback: CallbackQuery) -> None:
    """Handle rating selection callback: rate:{post_id}:{rating}."""
    data = callback.data
    if data is None:
        return

    parts = data.split(":")
    if len(parts) != 3:
        await callback.answer("Invalid data", show_alert=True)
        return

    _, post_id, rating = parts

    if post_id in _confirmed_posts:
        await callback.answer("已确认 / Already confirmed", show_alert=True)
        return

    # Update rating via backend API
    success = await update_post_rating(post_id, rating)

    if success:
        _confirmed_posts.add(post_id)
        rating_labels = {"safe": "🟢 公开", "questionable": "🟡 敏感", "explicit": "🔴 限制"}
        rating_label = rating_labels.get(rating, rating)
        post_url = f"{settings.FRONTEND_URL}/posts/{post_id}"
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🖼 查看作品 / View", url=post_url)]
        ])
        try:
            await callback.message.edit_text(  # type: ignore[union-attr]
                f"✅ 处理完成\n"
                f"评级: {rating_label}\n"
                f"Source ID: {post_id[:8]}…",
                reply_markup=keyboard,
            )
        except Exception:
            pass
    else:
        await callback.answer("更新失败 / Update failed", show_alert=True)
        return

    await callback.answer()


@router.callback_query(F.data.startswith("post:"))
async def callback_post_details(callback: CallbackQuery) -> None:
    """Handle inline keyboard callback for viewing post details."""
    data = callback.data
    if data is None:
        return

    # Parse callback data: post:<post_id>
    post_id = data.split(":", 1)[1] if ":" in data else ""

    if not post_id:
        await callback.answer("Invalid post ID", show_alert=True)
        return

    # Fetch post details from backend
    post = await get_post(post_id)

    if post is None:
        await callback.answer("Post not found", show_alert=True)
        return

    info_text = format_post_info(post)

    # Send as new message instead of editing — preserves search results
    try:
        await callback.message.answer(  # type: ignore[union-attr]
            info_text,
            parse_mode="Markdown",
        )
    except Exception as exc:
        logger.warning("Failed to send post details: %s", exc)

    await callback.answer()


@router.callback_query(F.data == "noop")
async def callback_noop(callback: CallbackQuery) -> None:
    """Handle no-op button presses (e.g., page indicator)."""
    await callback.answer()
