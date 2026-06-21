from __future__ import annotations

import logging

from aiogram import Router, F
from aiogram.types import (
    Message,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    CallbackQuery,
)
from aiogram.filters import Command

from app.services.backend_api import search_posts

logger = logging.getLogger(__name__)

router = Router()

RESULTS_PER_PAGE = 5


def build_search_keyboard(
    items: list[dict],
    page: int,
    total_pages: int,
    query: str,
) -> InlineKeyboardMarkup:
    """Build an inline keyboard for search results with pagination."""
    buttons: list[list[InlineKeyboardButton]] = []

    for item in items:
        post_id = item.get("id", "")
        title = item.get("title") or item.get("source_id", "Untitled")
        # Truncate long titles
        if len(title) > 40:
            title = title[:37] + "..."
        buttons.append(
            [
                InlineKeyboardButton(
                    text=title,
                    callback_data=f"post:{post_id}",
                )
            ]
        )

    # Truncate query in callback data to avoid 64-byte limit
    # Format: search:<query>:<page> — keep query ≤ 40 chars
    safe_query = query[:40] if len(query) > 40 else query

    # Pagination row
    nav_buttons: list[InlineKeyboardButton] = []
    if page > 1:
        nav_buttons.append(
            InlineKeyboardButton(
                text="◀ Prev",
                callback_data=f"search:{safe_query}:{page - 1}",
            )
        )
    nav_buttons.append(
        InlineKeyboardButton(
            text=f"{page}/{total_pages}",
            callback_data="noop",
        )
    )
    if page < total_pages:
        nav_buttons.append(
            InlineKeyboardButton(
                text="Next ▶",
                callback_data=f"search:{safe_query}:{page + 1}",
            )
        )
    buttons.append(nav_buttons)

    return InlineKeyboardMarkup(inline_keyboard=buttons)


@router.message(Command("search"))
@router.message(F.text.regexp(r"^!search\s"))
async def cmd_search(message: Message) -> None:
    """Handle /search or !search command — search posts by tags.

    Usage: /search <query> or !search <query>
    """
    text = message.text or ""

    # Extract the query part
    import re

    command_match = re.match(r"^(?:/search|!search)\s+(.+)", text, re.IGNORECASE)
    if not command_match:
        await message.answer(
            "用法 / Usage:\n`/search <tags>` or `!search <tags>`",
            parse_mode="Markdown",
        )
        return

    query = command_match.group(1).strip()
    if not query:
        await message.answer("⚠️ 请输入搜索关键词 / Please enter search tags.")
        return

    # Perform search
    result = await search_posts(query, page=1, per_page=RESULTS_PER_PAGE)

    if result is None:
        await message.answer("❌ 搜索失败 / Search failed. Please try again later.")
        return

    items = result.get("items", [])
    total = result.get("total", 0)

    if total == 0:
        await message.answer(f"🔍 没有找到结果 / No results for: `{query}`", parse_mode="Markdown")
        return

    total_pages = max(1, (total + RESULTS_PER_PAGE - 1) // RESULTS_PER_PAGE)
    keyboard = build_search_keyboard(items, page=1, total_pages=total_pages, query=query)

    await message.answer(
        f"🔍 搜索结果 / Search results for: `{query}`\n"
        f"Found {total} result(s)",
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


@router.callback_query(F.data.startswith("search:"))
async def callback_search_pagination(callback: CallbackQuery) -> None:
    """Handle pagination callbacks for search results."""
    data = callback.data
    if data is None:
        return

    # Parse callback data: search:<query>:<page>
    parts = data.split(":", 2)
    if len(parts) != 3:
        await callback.answer("Invalid callback data", show_alert=True)
        return

    _, query, page_str = parts
    try:
        page = int(page_str)
    except ValueError:
        await callback.answer("Invalid page number", show_alert=True)
        return

    result = await search_posts(query, page=page, per_page=RESULTS_PER_PAGE)

    if result is None:
        await callback.answer("Search failed", show_alert=True)
        return

    items = result.get("items", [])
    total = result.get("total", 0)

    if total == 0:
        await callback.answer("No results", show_alert=True)
        return

    total_pages = max(1, (total + RESULTS_PER_PAGE - 1) // RESULTS_PER_PAGE)
    keyboard = build_search_keyboard(items, page=page, total_pages=total_pages, query=query)

    await callback.message.edit_text(  # type: ignore[union-attr]
        f"🔍 搜索结果 / Search results for: `{query}`\n"
        f"Found {total} result(s)",
        parse_mode="Markdown",
        reply_markup=keyboard,
    )
    await callback.answer()