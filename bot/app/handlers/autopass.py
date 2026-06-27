from __future__ import annotations

import logging

from aiogram import Router, F
from aiogram.types import Message
from aiogram.filters import Command

from app.i18n import t, get_chat_lang, get_chat_autopass, set_chat_autopass

logger = logging.getLogger(__name__)

router = Router()


@router.message(Command("autopass"))
@router.message(F.text.regexp(r"^!autopass"))
async def cmd_autopass(message: Message) -> None:
    """Handle /autopass — toggle auto-confirm mode (skip rating UI, safe by default).

    Usage:
      /autopass on  — enable autopass
      /autopass off — disable autopass
      /autopass     — show current status
    """
    text = (message.text or "").strip().lower()
    chat_id = message.chat.id
    lang = await get_chat_lang(chat_id)

    # Parse argument
    parts = text.split()
    arg = parts[1] if len(parts) >= 2 else ""

    if arg in ("on", "true", "1", "yes", "开"):
        await set_chat_autopass(chat_id, True)
        await message.answer(t("autopass_on", lang), parse_mode="Markdown")
    elif arg in ("off", "false", "0", "no", "关"):
        await set_chat_autopass(chat_id, False)
        await message.answer(t("autopass_off", lang), parse_mode="Markdown")
    else:
        # Show current status
        is_on = await get_chat_autopass(chat_id)
        if is_on:
            await message.answer(t("autopass_status_on", lang), parse_mode="Markdown")
        else:
            await message.answer(t("autopass_status_off", lang), parse_mode="Markdown")
