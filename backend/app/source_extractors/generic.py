"""Generic source extractor for unknown URLs.

Provides basic URL parsing and returns source_site="other" with a
composite source_id derived from the hostname and path.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

from app.models.post import SourceSite
from app.source_extractors.base import BaseExtractor, ExtractorResult

logger = logging.getLogger(__name__)


class GenericExtractor(BaseExtractor):
    """Fallback extractor for URLs that don't match any known site pattern.

    Extracts basic information from the URL (hostname, path) and returns
    a result with source_site="other". Does not attempt to fetch metadata
    since the site is unknown.
    """

    async def extract(self, url: str) -> ExtractorResult:
        """Extract basic metadata from an unknown URL.

        Args:
            url: Any URL that doesn't match known site patterns.

        Returns:
            ExtractorResult with source_site="other" and a composite source_id.
        """
        parsed = urlparse(url)
        hostname = parsed.hostname or "unknown"
        # Create a composite ID from hostname + path for uniqueness
        path_id = parsed.path.strip("/").replace("/", "_") or "unknown"

        # Include query params in source_id for better uniqueness
        query_suffix = ""
        if parsed.query:
            # Take first few query params for a concise ID
            query_part = parsed.query.split("&")[0]
            query_suffix = f"_{query_part}"

        source_id = f"{hostname}_{path_id}{query_suffix}"

        logger.info("Generic extraction for URL: %s → source_id=%s", url, source_id)

        return ExtractorResult(
            source_site=SourceSite.other,
            source_id=source_id,
            title=None,
            description=None,
            tags=[],
            image_urls=[url],  # Use the URL itself as the image URL to try
        )

    @staticmethod
    def can_handle(url: str) -> bool:
        """Generic extractor can handle any URL as a fallback."""
        return True