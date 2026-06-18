from __future__ import annotations

from aiogram import Router
from aiogram.types import Message
from aiogram.filters import CommandStart

router = Router()


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    """Handle /start command — show welcome message and available commands."""
    text = (
        "👋 ようこそ！Welcome to **Kura Booru**!\n\n"
        "Send me an image URL and I'll download and archive it automatically.\n\n"
        "**Available commands:**\n"
        "• `!save <url>` — Explicitly save an image URL\n"
        "• `!search <query>` — Search your collection by tags\n"
        "• `!info` — Reply to a saved image to get details\n\n"
        "**Supported sites:** Pixiv, Twitter/X, Danbooru, and more!\n\n"
        "Just paste a URL and I'll handle the rest ✨"
    )
    await message.answer(text, parse_mode="Markdown")