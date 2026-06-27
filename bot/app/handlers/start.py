from __future__ import annotations

from aiogram import Router
from aiogram.types import Message
from aiogram.filters import CommandStart

from app.i18n import t, get_chat_lang, set_chat_lang, Lang

router = Router()


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    """Handle /start command — show welcome message and available commands."""
    chat_id = message.chat.id
    lang = await get_chat_lang(chat_id)
    await message.answer(t("start_welcome", lang), parse_mode="Markdown")


# ── /lang command ──────────────────────────────────────────────────────────

@router.message(Command("lang"))
async def cmd_lang(message: Message) -> None:
    """Handle /lang — switch bot language per chat."""
    text = (message.text or "").strip().lower()
    # Parse: /lang en or /lang zh
    parts = text.split()
    chat_id = message.chat.id

    if len(parts) == 2 and parts[1] in ("en", "zh"):
        new_lang: Lang = parts[1]  # type: ignore[assignment]
        await set_chat_lang(chat_id, new_lang)
        await message.answer(t("lang_set", new_lang))
    else:
        lang = await get_chat_lang(chat_id)
        await message.answer(t("lang_usage", lang))
