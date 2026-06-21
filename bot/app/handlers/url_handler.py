from __future__ import annotations

import asyncio
import logging
import re

from aiogram import Router, F
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton

from app.config import settings
from app.services.backend_api import create_process_task, get_post, update_post_rating
from app.services.arq_client import poll_job_result

logger = logging.getLogger(__name__)

router = Router()

# URL detection pattern — matches http(s) URLs in message text
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)

# Limit URLs processed per message to avoid abuse
URL_MESSAGE_LIMIT = 10

# In-memory set of post IDs that have been confirmed via rating selection
_confirmed_posts: set[str] = set()

# Seconds to wait for manual rating before auto-confirming
RATING_COUNTDOWN_SECONDS = 10

# Rating priority: higher value = more restrictive
_RATING_ORDER = {"safe": 0, "questionable": 1, "explicit": 2}
_RATING_LABELS = {"safe": "🟢 公开", "questionable": "🟡 敏感", "explicit": "🔴 限制"}

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
    """
    # Normalize phixiv.net proxy URLs back to pixiv.net
    normalized = re.sub(
        r"https?://(?:www\.)?phixiv\.net",
        "https://www.pixiv.net",
        url,
        flags=re.IGNORECASE,
    )

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
    """10-second countdown: show timer, then auto-confirm if user hasn't selected.

    If auto_rating was set by backend rules (e.g. tag matched a rule), use that.
    Otherwise default to safe.
    """
    final_rating = auto_rating or "safe"
    final_label = _RATING_LABELS.get(final_rating, final_rating)
    rule_hint = f"（自动规则）" if auto_rating else "（默认）"

    # Countdown display
    for remaining in range(RATING_COUNTDOWN_SECONDS, 0, -1):
        if post_id in _confirmed_posts:
            return  # User already selected
        try:
            await processing_msg.edit_text(
                f"⏳ 等待评级 / Awaiting rating ({remaining}s)\n"
                f"Source: {source_site} | ID: {source_id}\n"
                f"请选择评级 / Select rating:",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                    [
                        InlineKeyboardButton(text="🟢 公开", callback_data=f"rate:{post_id}:safe"),
                        InlineKeyboardButton(text="🟡 敏感", callback_data=f"rate:{post_id}:questionable"),
                        InlineKeyboardButton(text="🔴 限制", callback_data=f"rate:{post_id}:explicit"),
                    ]
                ]),
            )
        except Exception:
            pass  # Message deleted or edit rate-limited
        await asyncio.sleep(1)

    # Countdown finished — auto-confirm
    if post_id in _confirmed_posts:
        return

    _confirmed_posts.add(post_id)

    # If the auto-rating differs from the post's current rating, update it
    post_url = f"{settings.FRONTEND_URL}/posts/{post_id}"
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🖼 查看作品 / View", url=post_url)]
    ])
    try:
        await processing_msg.edit_text(
            f"✅ 处理完成\n"
            f"评级: {final_label} {rule_hint}\n"
            f"Source: {source_site} | ID: {source_id}",
            reply_markup=keyboard,
        )
    except Exception:
        pass  # Message deleted or too old


async def _poll_and_notify(
    message: Message,
    processing_msg: Message,
    task_id: str,
    source_site: str,
    source_id: str,
) -> None:
    """Background task: poll ARQ job and edit message on completion."""
    result = await poll_job_result(task_id, timeout=300, poll_delay=3)

    if result is None:
        try:
            await processing_msg.edit_text(
                f"⏰ 处理超时 / Processing timed out\n"
                f"Task: `{task_id}`",
                parse_mode="Markdown",
            )
        except Exception:
            pass
        return

    status = result.get("status")
    if status == "success":
        post_id = result.get("post_id")
        auto_rating = result.get("auto_rating")  # Set by backend auto-rating rules
        if post_id:
            # Show rating selection menu
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(text="🟢 公开", callback_data=f"rate:{post_id}:safe"),
                    InlineKeyboardButton(text="🟡 敏感", callback_data=f"rate:{post_id}:questionable"),
                    InlineKeyboardButton(text="🔴 限制", callback_data=f"rate:{post_id}:explicit"),
                ]
            ])

            # If auto-rating rule matched, hint the suggested rating
            if auto_rating:
                auto_label = _RATING_LABELS.get(auto_rating, auto_rating)
                prompt_text = (
                    f"⏳ 等待评级 / Awaiting rating\n"
                    f"Source: {source_site} | ID: {source_id}\n"
                    f"建议评级: {auto_label}（自动规则）\n"
                    f"请选择评级 / Select rating:"
                )
            else:
                prompt_text = (
                    f"⏳ 等待评级 / Awaiting rating\n"
                    f"Source: {source_site} | ID: {source_id}\n"
                    f"请选择评级 / Select rating:"
                )

            try:
                await processing_msg.edit_text(
                    prompt_text,
                    reply_markup=keyboard,
                )
            except Exception:
                pass
            # 10s countdown → auto-confirm
            asyncio.create_task(
                _countdown_and_auto_confirm(
                    processing_msg, post_id, source_site, source_id, auto_rating
                )
            )
        else:
            try:
                await processing_msg.edit_text(
                    f"✅ 处理完成 / Processing complete\n"
                    f"Source: {source_site} | ID: {source_id}\n"
                    f"Post ID: `{post_id}`",
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
                    f"⚠️ 图片过大 / Image too large\n"
                    f"{msg}\n"
                    f"Task: `{task_id}`",
                    parse_mode="Markdown",
                )
            elif error == "duplicate":
                existing_id = result.get("existing_post_id")
                if existing_id:
                    post_url = f"{settings.FRONTEND_URL}/posts/{existing_id}"
                    keyboard = InlineKeyboardMarkup(inline_keyboard=[
                        [InlineKeyboardButton(text="🖼 查看已有作品", url=post_url)]
                    ])
                    await processing_msg.edit_text(
                        f"⚠️ 重复图片 / Duplicate image",
                        reply_markup=keyboard,
                    )
                else:
                    await processing_msg.edit_text(
                        f"⚠️ 重复图片 / Duplicate image\n"
                        f"Task: `{task_id}`",
                        parse_mode="Markdown",
                    )
            else:
                await processing_msg.edit_text(
                    f"❌ 处理失败 / Processing failed\n"
                    f"Error: `{error}`\n"
                    f"{msg}\n"
                    f"Task: `{task_id}`",
                    parse_mode="Markdown",
                )
        except Exception:
            pass  # Message deleted or too old
    else:
        try:
            await processing_msg.edit_text(
                f"⚠️ 未知状态 / Unknown status: `{status}`\n"
                f"Task: `{task_id}`",
                parse_mode="Markdown",
            )
        except Exception:
            pass


async def process_url(message: Message, url: str) -> None:
    """Shared URL processing: identify source, dispatch task, poll and notify."""
    source_info = identify_source(url)

    if source_info is None:
        await message.answer("⚠️ 无法识别此链接的来源 / Unsupported URL source.")
        return

    source_site, source_id = source_info

    # Send "processing" reply
    processing_msg = await message.reply("⏳ 正在下载... / Downloading...")

    # Dispatch to backend
    result = await create_process_task(
        source_url=url,
        source_site=source_site,
        source_id=source_id,
    )

    if result is None:
        try:
            await processing_msg.edit_text(
                "❌ 下载失败 / Failed to create processing task.\n"
                "Please try again later."
            )
        except Exception:
            pass
        return

    # Start background polling
    task_id = result.get("task_id", "unknown")
    try:
        await processing_msg.edit_text(
            f"📥 已加入队列 / Queued for processing\n"
            f"Source: {source_site} | ID: {source_id}\n"
            f"Task: `{task_id}`\n"
            f"⏳ 正在处理中...",
            parse_mode="Markdown",
        )
    except Exception:
        pass

    # Fire-and-forget background polling
    asyncio.create_task(
        _poll_and_notify(message, processing_msg, task_id, source_site, source_id)
    )


async def _process_urls_sequential(
    message: Message, urls: list[str], source_labels: list[str]
) -> None:
    """Process multiple URLs one by one with status updates."""
    status_msg = await message.reply(
        f"🔗 找到 {len(urls)} 个链接，逐个处理中...\n"
        + "\n".join(f"  {i+1}. {label}" for i, label in enumerate(source_labels))
    )

    succeeded = 0
    failed = 0
    for url, label in zip(urls, source_labels):
        processing_msg = await message.reply(f"⏳ 正在处理: {label}")

        source_info = identify_source(url)
        if source_info is None:
            try:
                await processing_msg.edit_text(f"⚠️ 跳过（无法识别）: {label}")
            except Exception:
                pass
            failed += 1
            continue

        source_site, source_id = source_info
        result = await create_process_task(
            source_url=url, source_site=source_site, source_id=source_id,
        )
        if result is None:
            try:
                await processing_msg.edit_text(f"❌ 队列失败: {label}")
            except Exception:
                pass
            failed += 1
            continue

        task_id = result.get("task_id", "unknown")
        try:
            await processing_msg.edit_text(
                f"📥 已入队: {label}\nTask: `{task_id}`",
                parse_mode="Markdown",
            )
        except Exception:
            pass

        asyncio.create_task(
            _poll_and_notify(message, processing_msg, task_id, source_site, source_id)
        )
        succeeded += 1

    try:
        await status_msg.edit_text(
            f"✅ 处理完毕 / Done: 成功 {succeeded}, 失败 {failed}, 共 {len(urls)}"
        )
    except Exception:
        pass


# ── Plain text filter (matches direct text messages + forwarded text-only) ──
# F.text catches: (1) regular text messages, (2) forwarded/channel messages with
# no photo (forward_origin type "channel" with text has .text set, not .caption).
# Messages with photos (even forwarded) go to handle_photo_url → caption.

@router.message(F.text, ~F.text.startswith("/"), ~F.text.startswith("!"))
async def handle_url_message(message: Message) -> None:
    """Handle plain text messages that contain URLs (not commands).

    Works for direct messages, forwarded channel posts, and forwarded user
    messages — as long as the content is text-only (no photo attached).

    Behavior:
    - 0 recognized URLs → ignore silently
    - 1 recognized URL → process directly
    - 2+ recognized URLs → batch process all with progress updates
    """
    text = message.text
    if not text:
        return

    await _handle_urls_from_text(message, text)


@router.message(F.photo)
async def handle_photo_url(message: Message) -> None:
    """Handle messages with photos that contain a caption URL.

    Telegram delivers forwarded channel posts with a photo as:
    - message.photo is non-empty
    - message.text is None
    - message.caption contains the channel post text (with URLs)

    This also handles direct messages that include both a photo and a caption URL.
    """
    caption = message.caption
    if not caption:
        return

    await _handle_urls_from_text(message, caption)


async def _handle_urls_from_text(message: Message, text: str) -> None:
    """Extract URLs from text, filter to image sources, and process."""
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
        # No recognized image source URLs — ignore silently
        return

    if len(recognized) == 1:
        url, site, sid = recognized[0]
        logger.info("URL message: single URL → %s/%s from %s", site, sid, url)
        await process_url(message, url)
    else:
        urls = [r[0] for r in recognized]
        labels = [f"{r[1]}/{r[2]}" for r in recognized]
        logger.info(
            "URL message: %d URLs found → %s",
            len(urls),
            ", ".join(labels),
        )
        await _process_urls_sequential(message, urls, labels)
