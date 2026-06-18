"""gallery-dl integration service.

Uses gallery-dl as a Python library (not subprocess) via DownloadJob API.
Runs synchronous gallery-dl calls in ThreadPoolExecutor to avoid blocking
the async event loop.

Key design decisions:
- gallery-dl config is a global singleton set once at startup — never modify concurrently
- Use DownloadJob API for programmatic access
- Extract infojson metadata for tags, title, description
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import gallery_dl
import gallery_dl.config
import gallery_dl.job

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# ThreadPoolExecutor for running synchronous gallery-dl calls
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="gallery_dl")


def setup_gallery_dl_config() -> None:
    """Configure gallery-dl as a global singleton from environment variables.

    This must be called once at startup — never modify concurrently.
    Called from main.py lifespan handler.
    """
    # Pixiv authentication
    if settings.PIXIV_REFRESH_TOKEN:
        gallery_dl.config.set(
            ("extractor", "pixiv"), "refresh-token", settings.PIXIV_REFRESH_TOKEN
        )
    if settings.PIXIV_PHPSESSID:
        gallery_dl.config.set(
            ("extractor", "pixiv"), "cookies", {"PHPSESSID": settings.PIXIV_PHPSESSID}
        )

    # Rate limiting to avoid IP bans
    gallery_dl.config.set(("extractor",), "sleep-request", [0.5, 1.5])
    gallery_dl.config.set(("extractor",), "parallel", 1)

    # Write metadata to infojson files for extraction
    gallery_dl.config.set(("extractor",), "write-infojson", True)

    logger.info("gallery-dl config initialized")


async def download_from_url(url: str) -> dict[str, Any]:
    """Download image and extract metadata from a URL using gallery-dl.

    Uses gallery_dl.job.DownloadJob as Python API (not subprocess).
    Runs in ThreadPoolExecutor since gallery-dl is synchronous.

    Args:
        url: The source URL to download from.

    Returns:
        Dictionary with keys:
        - file_path: Path to the downloaded file (or None on failure)
        - title: Image/artwork title
        - description: Image/artwork description
        - tags: List of tag strings
        - image_urls: List of direct image URLs
        - metadata: Raw gallery-dl metadata dict
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _download_sync, url)


def _download_sync(url: str) -> dict[str, Any]:
    """Synchronous gallery-dl download — runs in ThreadPoolExecutor.

    Uses DownloadJob API to download files and extract metadata.
    Returns structured result dict.
    """
    result: dict[str, Any] = {
        "file_path": None,
        "title": None,
        "description": None,
        "tags": [],
        "image_urls": [],
        "metadata": {},
    }

    # Create a temp directory for downloads
    with tempfile.TemporaryDirectory(prefix="kura_gallerydl_") as tmpdir:
        try:
            # Set download destination to temp directory
            gallery_dl.config.set(("extractor",), "directory", tmpdir)

            # Create a DownloadJob for the URL
            job = gallery_dl.job.DownloadJob(url)

            # Run the download
            job.run()

            # Extract metadata from the job's extracted items
            if job.data:
                # gallery-dl stores extracted data in various places
                # depending on the extractor
                metadata = job.data
                result["metadata"] = metadata

                # Extract common fields
                result["title"] = metadata.get("title") or metadata.get("caption") or metadata.get("description")
                result["description"] = metadata.get("description") or metadata.get("caption")

                # Extract tags — gallery-dl stores them in "tags" field
                tags = metadata.get("tags", [])
                if isinstance(tags, dict):
                    # Some sites return tags as {category: [tags]}
                    tag_list = []
                    for category_tags in tags.values():
                        if isinstance(category_tags, list):
                            tag_list.extend(category_tags)
                        else:
                            tag_list.append(str(category_tags))
                    result["tags"] = tag_list
                elif isinstance(tags, list):
                    result["tags"] = [str(t) for t in tags]

                # Extract image URLs
                image_urls = []
                # gallery-dl may provide image URLs in different fields
                if "image_urls" in metadata:
                    image_urls = metadata["image_urls"]
                elif "url" in metadata:
                    image_urls = [metadata["url"]]
                result["image_urls"] = image_urls

            # Find downloaded files in the temp directory
            for root, dirs, files in os.walk(tmpdir):
                for fname in files:
                    fpath = os.path.join(root, fname)
                    if not fname.endswith(".json"):
                        result["file_path"] = fpath
                        break

        except Exception as exc:
            logger.error("gallery-dl download failed for %s: %s", url, exc)
            # Don't re-raise — return partial result with empty fields
            # The pipeline will handle missing data gracefully

    return result