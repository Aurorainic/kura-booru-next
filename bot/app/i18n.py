from __future__ import annotations

from typing import Literal

# ── i18n: language strings ──────────────────────────────────────────────────
# Default is "en". Users can switch with /lang zh or /lang en.
# Stored per-chat in Redis: kura:bot_lang:{chat_id}, TTL 30 days.

Lang = Literal["en", "zh"]

_STRINGS: dict[str, dict[str, str]] = {
    # ── /start ──
    "start_welcome": {
        "en": (
            "👋 Welcome to **Kura Booru**!\n\n"
            "Send me an image URL and I'll download and archive it automatically.\n\n"
            "**Commands:**\n"
            "• `/save <url>` — Save an image URL\n"
            "• `/search <query>` — Search by tags\n"
            "• `/random` — Show a random post\n"
            "• `/stats` — Gallery statistics\n"
            "• `/info <url>` — Post details\n"
            "• `/lang zh` — 切换中文\n\n"
            "**Supported sites:** Pixiv, Twitter/X, Danbooru, and more!\n\n"
            "Just paste a URL and I'll handle the rest ✨"
        ),
        "zh": (
            "👋 欢迎来到 **Kura Booru**！\n\n"
            "发送图片链接，我会自动下载归档。\n\n"
            "**命令：**\n"
            "• `/save <url>` — 保存图片链接\n"
            "• `/search <关键词>` — 按标签搜索\n"
            "• `/random` — 随机作品\n"
            "• `/stats` — 画廊统计\n"
            "• `/info <url>` — 作品详情\n"
            "• `/lang en` — Switch to English\n\n"
            "**支持站点：** Pixiv、Twitter/X、Danbooru 等！\n\n"
            "直接粘贴链接即可 ✨"
        ),
    },
    # ── /random ──
    "random_no_posts": {
        "en": "❌ No posts found.",
        "zh": "❌ 没有找到图片。",
    },
    # ── /stats ──
    "stats_failed": {
        "en": "❌ Failed to fetch stats.",
        "zh": "❌ 获取统计信息失败。",
    },
    "stats_body": {
        "en": "📊 **Kura Booru Stats**\n🖼 Posts: {total_posts}\n🏷 Tags: {total_tags}\n🔗 Tag links: {total_post_tags}\n💾 Storage: {size}",
        "zh": "📊 **Kura Booru 统计**\n🖼 作品: {total_posts}\n🏷 标签: {total_tags}\n🔗 标签关联: {total_post_tags}\n💾 存储: {size}",
    },
    # ── /search ──
    "search_usage": {
        "en": "Usage: `/search <tags>`",
        "zh": "用法：`/search <标签>`",
    },
    "search_empty_query": {
        "en": "⚠️ Please enter search tags.",
        "zh": "⚠️ 请输入搜索关键词。",
    },
    "search_failed": {
        "en": "❌ Search failed. Please try again later.",
        "zh": "❌ 搜索失败，请稍后再试。",
    },
    "search_no_results": {
        "en": "🔍 No results for: `{query}`",
        "zh": "🔍 没有找到结果：`{query}`",
    },
    "search_results": {
        "en": "🔍 Search results for: `{query}`\nFound {total} result(s)",
        "zh": "🔍 搜索结果：`{query}`\n共 {total} 条结果",
    },
    # ── /info ──
    "info_usage": {
        "en": "Usage:\n• `/info <url>` — Get info for a URL\n• Reply to a message with `/info`",
        "zh": "用法：\n• `/info <链接>` — 查看链接详情\n• 回复含链接的消息并发送 `/info`",
    },
    "info_unrecognized": {
        "en": "⚠️ Cannot identify this URL source.",
        "zh": "⚠️ 无法识别此链接来源。",
    },
    "info_not_found": {
        "en": "🔍 Post not found.\nSource: {site} | ID: {source_id}",
        "zh": "🔍 未找到此图片。\n来源: {site} | ID: {source_id}",
    },
    # ── /save ──
    "save_usage": {
        "en": "Usage: `/save <url>` or `!save <url>`",
        "zh": "用法：`/save <链接>` 或 `!save <链接>`",
    },
    # ── /lang ──
    "lang_set": {
        "en": "✅ Language set to English.",
        "zh": "✅ 已切换为中文。",
    },
    "lang_usage": {
        "en": "Usage: `/lang en` or `/lang zh`",
        "zh": "用法：`/lang en` 或 `/lang zh`",
    },
    # ── URL processing ──
    "url_unrecognized": {
        "en": "⚠️ Unsupported URL source.",
        "zh": "⚠️ 无法识别此链接来源。",
    },
    "url_downloading": {
        "en": "⏳ Downloading...",
        "zh": "⏳ 正在下载...",
    },
    "url_task_failed": {
        "en": "❌ Failed to create processing task.\nPlease try again later.",
        "zh": "❌ 下载失败，请稍后再试。",
    },
    "url_queued": {
        "en": "📥 Queued for processing\nSource: {site} | ID: {source_id}\nTask: `{task_id}`\n⏳ Processing...",
        "zh": "📥 已加入队列\n来源: {site} | ID: {source_id}\n任务: `{task_id}`\n⏳ 处理中...",
    },
    "url_timeout": {
        "en": "⏰ Processing timed out\nTask: `{task_id}`",
        "zh": "⏰ 处理超时\n任务: `{task_id}`",
    },
    "url_complete": {
        "en": "✅ Processing complete\nSource: {site} | ID: {source_id}",
        "zh": "✅ 处理完成\n来源: {site} | ID: {source_id}",
    },
    "url_too_large": {
        "en": "⚠️ Image too large\n{msg}\nTask: `{task_id}`",
        "zh": "⚠️ 图片过大\n{msg}\n任务: `{task_id}`",
    },
    "url_duplicate": {
        "en": "⚠️ Duplicate image",
        "zh": "⚠️ 重复图片",
    },
    "url_failed": {
        "en": "❌ Processing failed\nError: `{error}`\n{msg}\nTask: `{task_id}`",
        "zh": "❌ 处理失败\n错误: `{error}`\n{msg}\n任务: `{task_id}`",
    },
    "url_unknown_status": {
        "en": "⚠️ Unknown status: `{status}`\nTask: `{task_id}`",
        "zh": "⚠️ 未知状态: `{status}`\n任务: `{task_id}`",
    },
    # ── Rating ──
    "rating_awaiting": {
        "en": "⏳ Awaiting rating ({remaining}s)\nSource: {site} | ID: {source_id}\nSelect rating:",
        "zh": "⏳ 等待评级（{remaining}s）\n来源: {site} | ID: {source_id}\n请选择评级：",
    },
    "rating_awaiting_auto": {
        "en": "⏳ Awaiting rating\nSource: {site} | ID: {source_id}\nSuggested: {auto_label} (auto rule)\nSelect rating:",
        "zh": "⏳ 等待评级\n来源: {site} | ID: {source_id}\n建议评级: {auto_label}（自动规则）\n请选择评级：",
    },
    "rating_confirmed": {
        "en": "✅ Processing complete\nRating: {label} {hint}\nSource: {site} | ID: {source_id}",
        "zh": "✅ 处理完成\n评级: {label} {hint}\n来源: {site} | ID: {source_id}",
    },
    "rating_already_confirmed": {
        "en": "Already confirmed",
        "zh": "已确认",
    },
    "rating_manual_confirmed": {
        "en": "✅ Confirmed",
        "zh": "✅ 已确认",
    },
    "rating_update_may_have_failed": {
        "en": "⚠️ Complete (rating update may have failed)\nRating: {label}",
        "zh": "⚠️ 处理完成（评级更新可能失败）\n评级: {label}",
    },
    "rating_update_failed_alert": {
        "en": "Rating update may have failed",
        "zh": "评级更新可能失败",
    },
    # ── Rating labels ──
    "rating_safe": {"en": "🟢 Public", "zh": "🟢 公开"},
    "rating_questionable": {"en": "🟡 Sensitive", "zh": "🟡 敏感"},
    "rating_explicit": {"en": "🔴 Restricted", "zh": "🔴 限制"},
    # ── Rating hints ──
    "hint_auto_rule": {"en": "(auto rule)", "zh": "（自动规则）"},
    "hint_default": {"en": "(default)", "zh": "（默认）"},
    # ── Buttons ──
    "btn_view": {"en": "🖼 View", "zh": "🖼 查看作品"},
    "btn_view_existing": {"en": "🖼 View existing", "zh": "🖼 查看已有作品"},
    "btn_prev": {"en": "◀ Prev", "zh": "◀ 上一页"},
    "btn_next": {"en": "Next ▶", "zh": "下一页 ▶"},
    # ── Batch ──
    "batch_found": {
        "en": "🔗 Found {count} link(s), processing...",
        "zh": "🔗 找到 {count} 个链接，逐个处理中...",
    },
    "batch_processing": {
        "en": "⏳ Processing: {label}",
        "zh": "⏳ 正在处理: {label}",
    },
    "batch_skip_unrecognized": {
        "en": "⚠️ Skipped (unrecognized): {label}",
        "zh": "⚠️ 跳过（无法识别）: {label}",
    },
    "batch_queue_failed": {
        "en": "❌ Queue failed: {label}",
        "zh": "❌ 队列失败: {label}",
    },
    "batch_queued": {
        "en": "📥 Queued: {label}\nTask: `{task_id}`",
        "zh": "📥 已入队: {label}\n任务: `{task_id}`",
    },
    "batch_done": {
        "en": "✅ Done: {succeeded} succeeded, {failed} failed, {total} total",
        "zh": "✅ 处理完毕：成功 {succeeded}, 失败 {failed}, 共 {total}",
    },
}


def t(key: str, lang: Lang = "en", **kwargs: object) -> str:
    """Get a localized string. Falls back to English if key/lang missing."""
    entry = _STRINGS.get(key, {})
    text = entry.get(lang) or entry.get("en", key)
    if kwargs:
        text = text.format_map({k: str(v) for k, v in kwargs.items()})
    return text


# ── Per-chat language storage (Redis, 30-day TTL) ─────────────────────────

_LANG_TTL = 30 * 86400  # 30 days


async def get_chat_lang(chat_id: int) -> Lang:
    """Get the language preference for a chat. Defaults to 'en'."""
    from app.services.arq_client import get_arq_pool
    pool = await get_arq_pool()
    lang = await pool.get(f"kura:bot_lang:{chat_id}")
    if lang:
        decoded = lang.decode() if isinstance(lang, bytes) else lang
        if decoded in ("en", "zh"):
            return decoded
    return "en"


async def set_chat_lang(chat_id: int, lang: Lang) -> None:
    """Set the language preference for a chat."""
    from app.services.arq_client import get_arq_pool
    pool = await get_arq_pool()
    await pool.setex(f"kura:bot_lang:{chat_id}", _LANG_TTL, lang)
