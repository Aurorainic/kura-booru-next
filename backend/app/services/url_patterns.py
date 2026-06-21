"""Centralized URL pattern matching for source site identification.

This module is the single source of truth for URL patterns used to identify
and extract source IDs from image URLs. Both the backend (process_image task,
source extractors) and the bot (url_handler) reference these patterns.

When updating patterns, update this file and sync the bot's copy:
  bot/app/handlers/url_handler.py — add a comment at the top:
    # URL patterns: MIRROR of backend/app/services/url_patterns.py — keep in sync
"""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse


# ── Pixiv ──────────────────────────────────────────────────────────────────

PIXIV_PATTERNS: list[re.Pattern] = [
    # https://www.pixiv.net/artworks/12345678
    re.compile(
        r"(?:https?://)?(?:www\.)?pixiv\.net/(?:artworks|illust)/(\d+)",
        re.IGNORECASE,
    ),
    # https://www.pixiv.net/member_illust.php?illust_id=12345678
    re.compile(
        r"(?:https?://)?(?:www\.)?pixiv\.net/member_illust\.php\?.*illust_id=(\d+)",
        re.IGNORECASE,
    ),
    # https://www.pixiv.net/i/12345678 (Pixiv short link)
    re.compile(
        r"(?:https?://)?(?:www\.)?pixiv\.net/i/(\d+)",
        re.IGNORECASE,
    ),
    # https://www.phixiv.net/artworks/12345678 (Pixiv proxy)
    re.compile(
        r"(?:https?://)?(?:www\.)?phixiv\.net/(?:artworks|illust)/(\d+)",
        re.IGNORECASE,
    ),
]

# Regex to normalize phixiv.net proxy URLs back to pixiv.net
PHIXIV_NORMALIZE = re.compile(
    r"https?://(?:www\.)?phixiv\.net",
    re.IGNORECASE,
)


# ── Twitter / X ───────────────────────────────────────────────────────────

TWITTER_PATTERNS: list[re.Pattern] = [
    # https://twitter.com/user/status/12345 or https://x.com/user/status/12345
    re.compile(
        r"(?:https?://)?(?:www\.)?(?:twitter\.com|x\.com)/(\w+)/status/(\d+)",
        re.IGNORECASE,
    ),
]


# ── Danbooru / Safebooru ──────────────────────────────────────────────────

DANBOORU_PATTERNS: list[re.Pattern] = [
    # https://danbooru.donmai.us/posts/12345 or https://safebooru.donmai.us/posts/12345
    re.compile(
        r"(?:https?://)?(?:danbooru\.donmai\.us|safebooru\.donmai\.us)/posts/(\d+)",
        re.IGNORECASE,
    ),
]


# ── Source identification ─────────────────────────────────────────────────

def identify_source(url: str) -> Optional[tuple[str, str]]:
    """Identify the source site and extract the source ID from a URL.

    Also normalizes proxy URLs (e.g. phixiv.net → pixiv.net).

    Returns:
        (source_site, source_id) or None if not recognized.
        - source_site: "pixiv" | "twitter" | "danbooru"
        - source_id: the numeric ID on the source site
    """
    # Normalize phixiv.net proxy URLs back to pixiv.net
    normalized = PHIXIV_NORMALIZE.sub("https://www.pixiv.net", url)

    # Pixiv
    for pattern in PIXIV_PATTERNS:
        match = pattern.search(normalized)
        if match:
            return "pixiv", match.group(1)

    # Twitter / X
    for pattern in TWITTER_PATTERNS:
        match = pattern.search(normalized)
        if match:
            return "twitter", match.group(2)

    # Danbooru / Safebooru
    for pattern in DANBOORU_PATTERNS:
        match = pattern.search(normalized)
        if match:
            return "danbooru", match.group(1)

    return None


def resolve_source_or_other(url: str) -> tuple[str, str]:
    """Resolve a URL to its source site and ID, falling back to 'other'.

    Returns:
        (source_site, source_id) where source_site is one of the
        SourceSite enum values and source_id is the site-specific ID.
        For unrecognized URLs, returns ("other", "<hostname>_<path>").
    """
    result = identify_source(url)
    if result:
        return result

    # Fallback: use hostname + path as composite ID
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    path_id = parsed.path.strip("/").replace("/", "_") or "unknown"
    return "other", f"{hostname}_{path_id}"
