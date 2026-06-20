"""Danbooru source extractor.

Parses danbooru.donmai.us (and safebooru.donmai.us) URLs and extracts
post ID and metadata.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from app.models.post import Rating, SourceSite
from app.source_extractors.base import BaseExtractor, ExtractorResult

logger = logging.getLogger(__name__)

# URL patterns for Danbooru posts
DANBOORU_URL_PATTERNS = [
    # https://danbooru.donmai.us/posts/1234567
    # https://safebooru.donmai.us/posts/1234567
    re.compile(
        r"(?:https?://)?(?:danbooru\.donmai\.us|safebooru\.donmai\.us)/posts/(\d+)",
        re.IGNORECASE,
    ),
]


class DanbooruExtractor(BaseExtractor):
    """Extract metadata from Danbooru post URLs.

    Uses gallery-dl to fetch full metadata (title, description, tags, image URLs)
    from Danbooru post URLs.
    """

    async def extract(self, url: str) -> ExtractorResult:
        """Extract metadata from a Danbooru URL.

        Args:
            url: A Danbooru or Safebooru post URL.

        Returns:
            ExtractorResult with post metadata.

        Raises:
            ValueError: If the URL is not a valid Danbooru post URL.
        """
        post_id = self._extract_post_id(url)
        if not post_id:
            raise ValueError(f"Could not extract Danbooru post ID from URL: {url}")

        logger.info("Extracting Danbooru post %s", post_id)

        # Use gallery-dl to fetch metadata
        from app.services.gallery_dl import download_from_url

        try:
            result = await download_from_url(url)
            return ExtractorResult(
                source_site=SourceSite.danbooru,
                source_id=post_id,
                title=result.get("title"),
                description=result.get("description"),
                tags=result.get("tags", []),
                tag_categories=result.get("tag_categories", {}),
                image_urls=result.get("image_urls", []),
                rating=result.get("rating", Rating.safe),
            )
        except Exception:
            logger.exception("gallery-dl extraction failed for Danbooru URL: %s", url)
            # Return basic info even if gallery-dl fails
            return ExtractorResult(
                source_site=SourceSite.danbooru,
                source_id=post_id,
                image_urls=[],
            )

    @staticmethod
    def _extract_post_id(url: str) -> Optional[str]:
        """Extract the post ID from a Danbooru URL.

        Args:
            url: A Danbooru URL string.

        Returns:
            The post ID as a string, or None if not found.
        """
        for pattern in DANBOORU_URL_PATTERNS:
            match = pattern.search(url)
            if match:
                return match.group(1)
        return None

    @staticmethod
    def can_handle(url: str) -> bool:
        """Check if this extractor can handle the given URL."""
        return any(pattern.search(url) for pattern in DANBOORU_URL_PATTERNS)