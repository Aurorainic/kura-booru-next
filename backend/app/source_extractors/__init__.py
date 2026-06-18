"""Source extractors for various image hosting sites.

Each extractor implements the BaseExtractor interface to parse a URL
and return structured metadata (title, tags, image URLs, etc.).

The `get_extractor` function selects the appropriate extractor based on
the URL pattern, falling back to GenericExtractor for unknown sites.
"""

from app.source_extractors.base import BaseExtractor, ExtractorResult
from app.source_extractors.danbooru import DanbooruExtractor
from app.source_extractors.generic import GenericExtractor
from app.source_extractors.pixiv import PixivExtractor
from app.source_extractors.twitter import TwitterExtractor

__all__ = [
    "BaseExtractor",
    "ExtractorResult",
    "DanbooruExtractor",
    "GenericExtractor",
    "PixivExtractor",
    "TwitterExtractor",
    "get_extractor",
]

# Ordered list of extractors — more specific first, generic last
_EXTRACTORS: list[BaseExtractor] = [
    PixivExtractor(),
    TwitterExtractor(),
    DanbooruExtractor(),
    GenericExtractor(),  # Always last as fallback
]


def get_extractor(url: str) -> BaseExtractor:
    """Select the appropriate extractor for the given URL.

    Iterates through extractors in order and returns the first one that
    can handle the URL. Falls back to GenericExtractor for unknown sites.

    Args:
        url: The source URL to find an extractor for.

    Returns:
        A BaseExtractor instance that can handle the URL.
    """
    for extractor in _EXTRACTORS:
        if hasattr(extractor, "can_handle") and extractor.can_handle(url):
            return extractor
    # Fallback to generic (should never reach here since GenericExtractor.can_handle is always True)
    return _EXTRACTORS[-1]