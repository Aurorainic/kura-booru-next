"""Pixiv source extractor.

Parses pixiv.net URLs (artworks/, illust/) and extracts illustration ID
and metadata via gallery-dl.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.models.post import Rating, SourceSite
from app.services.url_patterns import PIXIV_URL_PATTERNS
from app.source_extractors.base import BaseExtractor, ExtractorResult

logger = logging.getLogger(__name__)


class PixivExtractor(BaseExtractor):
    """Extract metadata from Pixiv illustration URLs.

    Uses gallery-dl to fetch full metadata (title, description, tags, image URLs).
    The extract method is async but delegates to gallery-dl via ThreadPoolExecutor
    since gallery-dl is synchronous.
    """

    async def extract(self, url: str) -> ExtractorResult:
        """Extract metadata from a Pixiv URL.

        Args:
            url: A Pixiv artwork or illustration URL.

        Returns:
            ExtractorResult with illustration metadata.

        Raises:
            ValueError: If the URL is not a valid Pixiv illustration URL.
        """
        illust_id = self._extract_illust_id(url)
        if not illust_id:
            raise ValueError(f"Could not extract Pixiv illustration ID from URL: {url}")

        logger.info("Extracting Pixiv illustration %s", illust_id)

        # Use gallery-dl to fetch metadata
        from app.services.gallery_dl import download_from_url

        try:
            result = await download_from_url(url)
            return ExtractorResult(
                source_site=SourceSite.pixiv,
                source_id=illust_id,
                title=result.get("title"),
                description=result.get("description"),
                tags=result.get("tags", []),
                tag_categories=result.get("tag_categories", {}),
                image_urls=result.get("image_urls", []),
                image_bytes=result.get("image_bytes"),
                rating=result.get("rating", Rating.safe),
            )
        except Exception:
            logger.exception("gallery-dl extraction failed for Pixiv URL: %s", url)
            # Return basic info even if gallery-dl fails
            return ExtractorResult(
                source_site=SourceSite.pixiv,
                source_id=illust_id,
                image_urls=[],
            )

    @staticmethod
    def _extract_illust_id(url: str) -> Optional[str]:
        """Extract the illustration ID from a Pixiv URL.

        Args:
            url: A Pixiv URL string.

        Returns:
            The illustration ID as a string, or None if not found.
        """
        for pattern in PIXIV_URL_PATTERNS:
            match = pattern.search(url)
            if match:
                return match.group(1)
        return None

    @staticmethod
    def can_handle(url: str) -> bool:
        """Check if this extractor can handle the given URL."""
        return any(pattern.search(url) for pattern in PIXIV_URL_PATTERNS)