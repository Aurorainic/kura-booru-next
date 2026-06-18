from __future__ import annotations

import logging

from aiogram import Router, F
from aiogram.types import CallbackQuery

from app.handlers.info import format_post_info
from app.services.backend_api import get_post

logger = logging.getLogger(__name__)

router = Router()


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

    # Edit the message to show post details
    try:
        await callback.message.edit_text(  # type: ignore[union-attr]
            info_text,
            parse_mode="Markdown",
        )
    except Exception as exc:
        # If editing fails (e.g., message too long), send as new message
        logger.warning("Failed to edit message for post details: %s", exc)
        await callback.message.answer(  # type: ignore[union-attr]
            info_text,
            parse_mode="Markdown",
        )

    await callback.answer()


@router.callback_query(F.data == "noop")
async def callback_noop(callback: CallbackQuery) -> None:
    """Handle no-op button presses (e.g., page indicator)."""
    await callback.answer()