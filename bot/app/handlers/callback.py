from __future__ import annotations

import logging

from aiogram import Router, F
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton

from app.config import settings
from app.handlers.info import format_post_info
from app.handlers.url_handler import _is_confirmed, _mark_confirmed, _RATING_ORDER, _RATING_LABELS, cancel_countdown
from app.services.backend_api import get_post, update_post_rating
from app.i18n import t, get_chat_lang

logger = logging.getLogger(__name__)

router = Router()


@router.callback_query(F.data.startswith("rate:"))
async def callback_rate_post(callback: CallbackQuery) -> None:
    """Handle rating selection callback: rate:{post_id}:{rating}.

    The user's manual selection always takes final priority.
    The backend auto-rating rules already set an initial rating, but the
    user can override it (including choosing a less restrictive rating).
    """
    data = callback.data
    logger.info("callback_rate_post: data=%r, from_user=%s", data, callback.from_user)
    if data is None:
        return

    parts = data.split(":")
    if len(parts) != 3:
        await callback.answer("Invalid data", show_alert=True)
        return

    _, post_id, rating = parts
    lang = await get_chat_lang(callback.from_user.id)

    if await _is_confirmed(post_id):
        await callback.answer(t("rating_already_confirmed", lang), show_alert=True)
        return

    # Cancel the countdown task so it doesn't overwrite our edit
    cancel_countdown(post_id)

    # Update rating via backend API — user's choice overrides auto-rating
    success = await update_post_rating(post_id, rating)
    logger.info("callback_rate_post: update_post_rating(%s, %s) = %s", post_id, rating, success)

    rating_label = _RATING_LABELS.get(rating, rating)
    post_url = f"{settings.FRONTEND_URL}/posts/{post_id}"
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t("btn_view", lang), url=post_url)]
    ])

    if success:
        await _mark_confirmed(post_id)
        try:
            await callback.message.edit_text(  # type: ignore[union-attr]
                f"✅ 处理完成\n"
                f"评级: {rating_label}\n"
                f"Source ID: {post_id[:8]}…",
                reply_markup=keyboard,
            )
        except Exception as exc:
            logger.error("callback_rate_post: edit_text failed: %s", exc)
        await callback.answer(t("rating_manual_confirmed", lang), show_alert=False)
    else:
        # Even if backend update fails, still show "completed" state to unstick the UI
        logger.warning("callback_rate_post: rating update failed, showing completed state anyway")
        try:
            await callback.message.edit_text(  # type: ignore[union-attr]
                t("rating_update_may_have_failed", lang, label=rating_label),
                reply_markup=keyboard,
            )
        except Exception as exc:
            logger.error("callback_rate_post: fallback edit_text failed: %s", exc)
        await callback.answer(t("rating_update_failed_alert", lang), show_alert=True)


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
