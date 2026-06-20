"""Base extractor class for source URL metadata extraction.

Each site-specific extractor implements the `extract` method to parse
a URL and return structured metadata: source site, ID, title, description,
tags, and image URLs.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

from app.models.post import Rating, SourceSite


@dataclass
class ExtractorResult:
    """Structured metadata extracted from a source URL."""

    source_site: SourceSite
    source_id: str
    title: Optional[str] = None
    description: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    tag_categories: dict[str, str] = field(default_factory=dict)
    image_urls: list[str] = field(default_factory=list)
    image_bytes: Optional[bytes] = None
    rating: Rating = Rating.safe


class BaseExtractor(ABC):
    """Abstract base class for site-specific URL extractors.

    Subclasses must implement `extract()` which receives a URL and returns
    an ExtractorResult with all available metadata from the source page.
    """

    @abstractmethod
    async def extract(self, url: str) -> ExtractorResult:
        """Extract metadata from the given source URL.

        Args:
            url: The source URL to extract metadata from.

        Returns:
            ExtractorResult with source info, tags, and image URLs.
        """
        ...