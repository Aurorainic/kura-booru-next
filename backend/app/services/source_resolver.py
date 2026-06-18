"""Source URL resolver.

Extracts source_site and source_id from known URL patterns.
Supports: pixiv.net, twitter.com/x.com, danbooru.donmai.us.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

from app.models.post import SourceSite


@dataclass
class SourceInfo:
    """Parsed source information from a URL."""

    site: SourceSite
    id: str
    original_url: str


# ── URL pattern matchers ──────────────────────────────────────────────

PIXIV_PATTERNS = [
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
]

TWITTER_PATTERNS = [
    # https://twitter.com/user/status/1234567890
    re.compile(
        r"(?:https?://)?(?:www\.)?(?:twitter\.com|x\.com)/(\w+)/status/(\d+)",
        re.IGNORECASE,
    ),
]

DANBOORU_PATTERNS = [
    # https://danbooru.donmai.us/posts/1234567
    re.compile(
        r"(?:https?://)?(?:danbooru\.donmai\.us|safebooru\.donmai\.us)/posts/(\d+)",
        re.IGNORECASE,
    ),
]


def resolve_source(url: str) -> Optional[SourceInfo]:
    """Resolve a URL to its source site and ID.

    Args:
        url: The source URL to parse.

    Returns:
        SourceInfo if the URL matches a known pattern, None otherwise.
    """
    parsed = urlparse(url)
    hostname = parsed.hostname or ""

    # ── Pixiv ────────────────────────────────────────────────────
    if "pixiv" in hostname:
        for pattern in PIXIV_PATTERNS:
            match = pattern.search(url)
            if match:
                return SourceInfo(
                    site=SourceSite.pixiv,
                    id=match.group(1),
                    original_url=url,
                )

    # ── Twitter / X ─────────────────────────────────────────────
    if "twitter" in hostname or "x.com" in hostname:
        for pattern in TWITTER_PATTERNS:
            match = pattern.search(url)
            if match:
                # Use the status ID, not the username
                return SourceInfo(
                    site=SourceSite.twitter,
                    id=match.group(2),
                    original_url=url,
                )

    # ── Danbooru / Safebooru ─────────────────────────────────────
    if "donmai.us" in hostname:
        for pattern in DANBOORU_PATTERNS:
            match = pattern.search(url)
            if match:
                return SourceInfo(
                    site=SourceSite.danbooru,
                    id=match.group(1),
                    original_url=url,
                )

    # ── Unknown site ─────────────────────────────────────────────
    return None


def resolve_source_or_other(url: str) -> SourceInfo:
    """Resolve a URL, falling back to 'other' if not recognized."""
    result = resolve_source(url)
    if result:
        return result

    # Fallback: use the hostname as source_id prefix
    parsed = urlparse(url)
    hostname = parsed.hostname or "unknown"
    # Create a composite ID from hostname + path
    path_id = parsed.path.strip("/").replace("/", "_") or "unknown"
    return SourceInfo(
        site=SourceSite.other,
        id=f"{hostname}_{path_id}",
        original_url=url,
    )