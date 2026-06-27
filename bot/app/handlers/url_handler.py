from __future__ import annotations

import asyncio
import logging
import re

from aiogram import Router, F
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton

from app.config import settings
from app.services.backend_api import create_process_task, get_post, update_post_rating
from app.services.arq_client import poll_job_result
from app.i18n import t, get_chat_lang, get_chat_autopass

logger = logging.getLogger(__name__)

router = Router()

# Active countdown tasks keyed by post_id — used to cancel countdown when user
# selects a rating button before timeout.
_countdown_tasks: dict[str, asyncio.Task] = {}

# ── Per-chat processing queue ───────────────────────────────────────────────
# Each chat gets its own queue so URLs are processed serially per user,
# preventing backend overload from concurrent requests.
_chat_queues: dict[int, asyncio.Queue[asyncio.Coroutine]] = {}
_chat_workers: dict[int, asyncio.Task] = {}


async def _get_chat_queue(chat_id: int) -> asyncio.Queue:
    """Get or create the processing queue for a chat."""
    if chat_id not in _chat_queues:
        _chat_queues[chat_id] = asyncio.Queue()
        _chat_workers[chat_id] = asyncio.create_task(
            _chat_queue_worker(chat_id, _chat_queues[chat_id])
        )
    return _chat_queues[chat_id]


async def _chat_queue_worker(chat_id: int, queue: asyncio.Queue) -> None:
    """Worker that processes queued coroutines one at a time for a chat."""
    while True:
        try:
            coro = await queue.get()
            await coro
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("chat_queue_worker error for chat %s", chat_id)
        finally:
            queue.task_done()


# URL detection pattern — matches http(s) URLs in message text
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)

# Limit URLs processed per message to avoid abuse
URL_MESSAGE_LIMIT = 10

# In-memory set of post IDs that have been confirmed via rating selection.
# Stored in Redis with TTL so state survives restarts and works with multiple workers.
# Key: kura:confirmed_posts:{post_id}, TTL: 24h
_CONFIRMED_POSTS_TTL = 86400  # 24 hours


async def _is_confirmed(post_id: str) -> bool:
    """Check if a post has already been confirmed via rating selection."""
    from app.services.arq_client import get_arq_pool
    pool = await get_arq_pool()
    return await pool.exists(f"kura:confirmed_posts:{post_id}") > 0


async def _mark_confirmed(post_id: str) -> None:
    """Mark a post as confirmed via rating selection (with TTL)."""
    from app.services.arq_client import get_arq_pool
    pool = await get_arq_pool()
    await pool.setex(f"kura:confirmed_posts:{post_id}", _CONFIRMED_POSTS_TTL, "1")


def cancel_countdown(post_id: str) -> bool:
    """Cancel the countdown task for a post if one is running.

    Returns True if a task was found and canceled, False otherwise.
    Called from the callback handler when the user selects a rating button.
    """
    task = _countdown_tasks.pop(post_id, None)
    if task is not None and not task.done():
        task.cancel()
        return True
    return False

# Seconds to wait for manual rating before auto-confirming
RATING_COUNTDOWN_SECONDS = 10

# Rating priority: higher value = more restrictive
_RATING_ORDER = {"safe": 0, "questionable": 1, "explicit": 2}
_RATING_LABELS = {"safe": "🟢 公开", "questionable": "🟡 敏感", "explicit": "🔴 限制"}

# ── URL patterns: MIRROR of backend/app/services/url_patterns.py — keep in sync ──
# When updating patterns, update backend/app/services/url_patterns.py first,
# then sync changes here. The bot is a separate Python package and cannot
# import from the backend directly.

# Regex to normalize phixiv.net proxy URLs back to pixiv.net
_PHIXIV_NORMALIZE = re.compile(
    r"https?://(?:www\.)?phixiv\.net",
    re.IGNORECASE,
)

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

    MIRROR of backend/app/services/url_patterns.py:identify_source — keep in sync.
    """
    # Normalize phixiv.net proxy URLs back to pixiv.net
    normalized = _PHIXIV_NORMALIZE.sub("https://www.pixiv.net", url)

    for pattern, site_name in SOURCE_PATTERNS:
        match = pattern.search(normalized)
        if match:
            return site_name, match.group(1)

    # Unknown source — not processable
    return None


async def _countdown_and_auto_confirm(
    processing_msg: Message,
    post_id: str,
    source_site: str,
    source_id: str,
    auto_rating: str | None,
) -> None:
    """10-second countdown: show timer, then auto-confirm if user hasn't selected."""
    final_rating = auto_rating or "safe"
    final_label = _RATING_LABELS.get(final_rating, final_rating)
    chat_id = processing_msg.chat.id
    lang = await get_chat_lang(chat_id)
    hint_key = "hint_auto_rule" if auto_rating else "hint_default"
    rule_hint = t(hint_key, lang)

    try:
        for remaining in range(RATING_COUNTDOWN_SECONDS, 0, -1):
            if await _is_confirmed(post_id):
                return
            try:
                if auto_rating:
                    auto_label = _RATING_LABELS.get(auto_rating, auto_rating)
                    prompt_text = t("rating_awaiting_auto", lang, site=source_site, source_id=source_id, auto_label=auto_label)
                else:
                    prompt_text = t("rating_awaiting", lang, remaining=remaining, site=source_site, source_id=source_id)
                await processing_msg.edit_text(
                    prompt_text,
                    reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                        [
                            InlineKeyboardButton(text=t("rating_safe", lang), callback_data=f"rate:{post_id}:safe"),
                            InlineKeyboardButton(text=t("rating_questionable", lang), callback_data=f"rate:{post_id}:questionable"),
                            InlineKeyboardButton(text=t("rating_explicit", lang), callback_data=f"rate:{post_id}:explicit"),
                        ]
                    ]),
                )
            except Exception:
                pass
            await asyncio.sleep(1)

        if await _is_confirmed(post_id):
            return

        await _mark_confirmed(post_id)

        post_url = f"{settings.FRONTEND_URL}/posts/{post_id}"
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=t("btn_view", lang), url=post_url)]
        ])
        try:
            await processing_msg.edit_text(
                t("rating_confirmed", lang, label=final_label, hint=rule_hint, site=source_site, source_id=source_id),
                reply_markup=keyboard,
            )
        except Exception:
            pass
    except asyncio.CancelledError:
        return
    finally:
        _countdown_tasks.pop(post_id, None)


async def _poll_and_notify(
    processing_msg: Message,
    task_id: str,
    source_site: str,
    source_id: str,
) -> None:
    """Poll ARQ job and edit message on completion. Awaits completion (blocking)."""
    chat_id = processing_msg.chat.id
    lang = await get_chat_lang(chat_id)

    result = await poll_job_result(task_id, timeout=300, poll_delay=3)

    if result is None:
        try:
            await processing_msg.edit_text(
                t("url_timeout", lang, task_id=task_id),
                parse_mode="Markdown",
            )
        except Exception:
            pass
        return

    status = result.get("status")
    if status == "success":
        post_id = result.get("post_id")
        auto_rating = result.get("auto_rating")
        if post_id:
            # Check autopass mode — skip rating UI, confirm as safe immediately
            autopass = await get_chat_autopass(chat_id)
            if autopass:
                final_rating = auto_rating or "safe"
                if auto_rating and auto_rating != "safe":
                    await update_post_rating(post_id, auto_rating)
                elif auto_rating is None:
                    await update_post_rating(post_id, "safe")
                await _mark_confirmed(post_id)

                final_label = _RATING_LABELS.get(final_rating, final_rating)
                post_url = f"{settings.FRONTEND_URL}/posts/{post_id}"
                keyboard = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text=t("btn_view", lang), url=post_url)]
                ])
                try:
                    await processing_msg.edit_text(
                        t("rating_confirmed", lang, label=final_label, hint=t("hint_auto_rule", lang) if auto_rating else t("hint_default", lang), site=source_site, source_id=source_id),
                        reply_markup=keyboard,
                    )
                except Exception:
                    pass
                return

            # Normal mode — show rating selection UI
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(text=t("rating_safe", lang), callback_data=f"rate:{post_id}:safe"),
                    InlineKeyboardButton(text=t("rating_questionable", lang), callback_data=f"rate:{post_id}:questionable"),
                    InlineKeyboardButton(text=t("rating_explicit", lang), callback_data=f"rate:{post_id}:explicit"),
                ]
            ])

            if auto_rating:
                auto_label = _RATING_LABELS.get(auto_rating, auto_rating)
                prompt_text = t("rating_awaiting_auto", lang, site=source_site, source_id=source_id, auto_label=auto_label)
            else:
                prompt_text = t("rating_awaiting", lang, remaining=RATING_COUNTDOWN_SECONDS, site=source_site, source_id=source_id)

            try:
                await processing_msg.edit_text(prompt_text, reply_markup=keyboard)
            except Exception:
                pass
            # Countdown runs in background (doesn't block the queue)
            countdown_task = asyncio.create_task(
                _countdown_and_auto_confirm(processing_msg, post_id, source_site, source_id, auto_rating)
            )
            _countdown_tasks[post_id] = countdown_task
            # Wait for countdown to finish (user selects rating or auto-confirms)
            await countdown_task
        else:
            try:
                await processing_msg.edit_text(
                    t("url_complete", lang, site=source_site, source_id=source_id),
                    parse_mode="Markdown",
                )
            except Exception:
                pass
    elif status == "error":
        error = result.get("error", "unknown")
        msg = result.get("message", "Unknown error")
        try:
            if error == "image_too_large":
                await processing_msg.edit_text(
                    t("url_too_large", lang, msg=msg, task_id=task_id),
                    parse_mode="Markdown",
                )
            elif error == "duplicate":
                existing_id = result.get("existing_post_id")
                if existing_id:
                    post_url = f"{settings.FRONTEND_URL}/posts/{existing_id}"
                    keyboard = InlineKeyboardMarkup(inline_keyboard=[
                        [InlineKeyboardButton(text=t("btn_view_existing", lang), url=post_url)]
                    ])
                    await processing_msg.edit_text(t("url_duplicate", lang), reply_markup=keyboard)
                else:
                    await processing_msg.edit_text(
                        t("url_duplicate", lang) + f"\nTask: `{task_id}`",
                        parse_mode="Markdown",
                    )
            else:
                await processing_msg.edit_text(
                    t("url_failed", lang, error=error, msg=msg, task_id=task_id),
                    parse_mode="Markdown",
                )
        except Exception:
            pass
    else:
        try:
            await processing_msg.edit_text(
                t("url_unknown_status", lang, status=status, task_id=task_id),
                parse_mode="Markdown",
            )
        except Exception:
            pass


async def _process_one_url(message: Message, url: str) -> None:
    """Process a single URL end-to-end: dispatch → poll → rating. Blocks until done."""
    source_info = identify_source(url)
    lang = await get_chat_lang(message.chat.id)

    if source_info is None:
        await message.answer(t("url_unrecognized", lang))
        return

    source_site, source_id = source_info
    processing_msg = await message.reply(t("url_downloading", lang))

    result = await create_process_task(
        source_url=url, source_site=source_site, source_id=source_id,
    )

    if result is None:
        try:
            await processing_msg.edit_text(t("url_task_failed", lang))
        except Exception:
            pass
        return

    task_id = result.get("task_id", "unknown")
    try:
        await processing_msg.edit_text(
            t("url_queued", lang, site=source_site, source_id=source_id, task_id=task_id),
            parse_mode="Markdown",
        )
    except Exception:
        pass

    # Await polling — blocks until this URL is fully processed
    await _poll_and_notify(processing_msg, task_id, source_site, source_id)


async def _process_urls_sequential(
    message: Message, urls: list[str], source_labels: list[str]
) -> None:
    """Process multiple URLs one by one, enqueuing each to the chat queue."""
    lang = await get_chat_lang(message.chat.id)
    queue = await _get_chat_queue(message.chat.id)
    queued = 0

    for url, label in zip(urls, source_labels):
        source_info = identify_source(url)
        if source_info is None:
            continue
        await queue.put(_process_one_url(message, url))
        queued += 1

    if queued > 0:
        await message.reply(t("batch_found", lang, count=queued))


# ── Plain text filter ──

@router.message(F.text, ~F.text.startswith("/"), ~F.text.startswith("!"))
async def handle_url_message(message: Message) -> None:
    """Handle plain text messages that contain URLs (not commands)."""
    text = message.text
    if not text:
        return

    await _handle_urls_from_text(message, text)


@router.message(F.photo)
async def handle_photo_url(message: Message) -> None:
    """Handle messages with photos that contain a caption URL."""
    caption = message.caption
    if not caption:
        return

    await _handle_urls_from_text(message, caption)


async def _handle_urls_from_text(message: Message, text: str) -> None:
    """Extract URLs from text, filter to image sources, and enqueue for processing."""
    all_urls = URL_PATTERN.findall(text)

    if not all_urls:
        return

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_urls: list[str] = []
    for u in all_urls:
        if u not in seen:
            seen.add(u)
            unique_urls.append(u)

    # Filter to recognized image sources first, then cap at limit
    recognized: list[tuple[str, str, str]] = []  # (url, site, id)
    for url in unique_urls:
        info = identify_source(url)
        if info:
            recognized.append((url, info[0], info[1]))
        if len(recognized) >= URL_MESSAGE_LIMIT:
            break

    if not recognized:
        return

    queue = await _get_chat_queue(message.chat.id)

    if len(recognized) == 1:
        url, site, sid = recognized[0]
        logger.info("URL message: single URL → %s/%s from %s", site, sid, url)
        await queue.put(_process_one_url(message, url))
    else:
        urls = [r[0] for r in recognized]
        labels = [f"{r[1]}/{r[2]}" for r in recognized]
        logger.info("URL message: %d URLs found → %s", len(urls), ", ".join(labels))
        await _process_urls_sequential(message, urls, labels)
