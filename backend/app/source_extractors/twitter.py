"""Twitter/X source extractor.

Parses twitter.com or x.com URLs and extracts tweet ID from status URLs.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from app.models.post import SourceSite
from app.source_extractors.base import BaseExtractor, ExtractorResult

logger = logging.getLogger(__name__)

# URL patterns for Twitter/X status URLs
TWITTER_URL_PATTERNS = [
    # https://twitter.com/user/status/1234567890
    # https://x.com/user/status/1234567890
    re.compile(
        r"(?:https?://)?(?:www\.)?(?:twitter\.com|x\.com)/(\w+)/status/(\d+)",
        re.IGNORECASE,
    ),
]


class TwitterExtractor(BaseExtractor):
    """Extract metadata from Twitter/X tweet URLs.

    Uses gallery-dl to fetch full metadata (description, tags, image URLs)
    from tweet URLs.
    """

    async def extract(self, url: str) -> ExtractorResult:
        """Extract metadata from a Twitter/X URL.

        Args:
            url: A Twitter or X status URL.

        Returns:
            ExtractorResult with tweet metadata.

        Raises:
            ValueError: If the URL is not a valid Twitter/X status URL.
        """
        tweet_id = self._extract_tweet_id(url)
        if not tweet_id:
            raise ValueError(f"Could not extract tweet ID from URL: {url}")

        logger.info("Extracting Twitter/X tweet %s", tweet_id)

        # Use gallery-dl to fetch metadata
        from app.services.gallery_dl import download_from_url

        try:
            result = await download_from_url(url)
            return ExtractorResult(
                source_site=SourceSite.twitter,
                source_id=tweet_id,
                title=result.get("title"),
                description=result.get("description"),
                tags=result.get("tags", []),
                image_urls=result.get("image_urls", []),
            )
        except Exception:
            logger.exception("gallery-dl extraction failed for Twitter URL: %s", url)
            # Return basic info even if gallery-dl fails
            return ExtractorResult(
                source_site=SourceSite.twitter,
                source_id=tweet_id,
                image_urls=[],
            )

    @staticmethod
    def _extract_tweet_id(url: str) -> Optional[str]:
        """Extract the tweet ID from a Twitter/X URL.

        Args:
            url: A Twitter or X URL string.

        Returns:
            The tweet ID as a string, or None if not found.
        """
        for pattern in TWITTER_URL_PATTERNS:
            match = pattern.search(url)
            if match:
                # Group 2 is the status ID, group 1 is the username
                return match.group(2)
        return None

    @staticmethod
    def can_handle(url: str) -> bool:
        """Check if this extractor can handle the given URL."""
        return any(pattern.search(url) for pattern in TWITTER_URL_PATTERNS)