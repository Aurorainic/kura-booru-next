"""gallery-dl integration service.

Uses gallery-dl as a Python library (not subprocess).
Runs synchronous gallery-dl calls in ThreadPoolExecutor to avoid blocking
the async event loop.

Key design decisions:
- gallery-dl config is a global singleton set once at startup — never modify concurrently
- DownloadJob downloads files, DataJob collects metadata (we use both)
- Extract infojson metadata for tags, title, description
"""

from __future__ import annotations

import asyncio
import io
import json
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
    Called from main.py lifespan handler and worker on_startup.
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

    Strategy:
    1. Use DataJob (with StringIO) to collect metadata without downloading.
    2. Use DownloadJob to actually download the file.
    3. Fall back to reading infojson if available.
    """
    result: dict[str, Any] = {
        "file_path": None,
        "title": None,
        "description": None,
        "tags": [],
        "image_urls": [],
        "metadata": {},
    }

    # First, use DataJob to get metadata
    try:
        buf = io.StringIO()
        data_job = gallery_dl.job.DataJob(url, file=buf, resolve=True)
        data_job.run()
        buf.seek(0)
        raw_json = buf.read()
        if raw_json:
            items = json.loads(raw_json)
            # DataJob returns a list of tuples:
            #   [MessageType, url_or_directory, metadata]
            # MessageType values: Directory=2, Url=3, Queue=6
            # We want items where the first element is 3 (Url)
            for item in items:
                if len(item) >= 3 and item[0] == gallery_dl.job.Message.Url:
                    metadata = item[2]
                    if isinstance(metadata, dict):
                        result["metadata"] = metadata
                        result["title"] = (
                            metadata.get("title")
                            or metadata.get("caption")
                            or metadata.get("description")
                        )
                        result["description"] = (
                            metadata.get("description") or metadata.get("caption")
                        )
                        # Tags
                        tags = metadata.get("tags", [])
                        if isinstance(tags, dict):
                            tag_list = []
                            for cat_tags in tags.values():
                                if isinstance(cat_tags, list):
                                    tag_list.extend(cat_tags)
                                else:
                                    tag_list.append(str(cat_tags))
                            result["tags"] = tag_list
                        elif isinstance(tags, list):
                            result["tags"] = [str(t) for t in tags]
                        # Image URL(s)
                        if "url" in metadata:
                            result["image_urls"].append(metadata["url"])
                        break  # Use first Url entry
    except Exception as exc:
        logger.warning("gallery-dl DataJob failed for %s: %s", url, exc)

    # Second, download the actual file
    with tempfile.TemporaryDirectory(prefix="kura_gallerydl_") as tmpdir:
        try:
            # Set download destination (base-directory controls root path)
            gallery_dl.config.set(("extractor",), "base-directory", tmpdir)

            dl_job = gallery_dl.job.DownloadJob(url)
            dl_job.run()

            # Find downloaded files (skip .json metadata files)
            downloaded_path = None
            for root, dirs, files in os.walk(tmpdir):
                for fname in files:
                    if fname.endswith(".json"):
                        continue
                    downloaded_path = os.path.join(root, fname)
                    break
                if downloaded_path:
                    break

            # Read file bytes while temp dir still exists
            if downloaded_path:
                try:
                    with open(downloaded_path, "rb") as f:
                        result["image_bytes"] = f.read()
                    logger.info(
                        "Read %d bytes from gallery-dl downloaded file: %s",
                        len(result["image_bytes"]),
                        downloaded_path,
                    )
                except Exception as exc:
                    logger.warning("Failed to read downloaded file %s: %s", downloaded_path, exc)

            # If DataJob didn't get metadata, try reading infojson
            if not result["metadata"]:
                for root, dirs, files in os.walk(tmpdir):
                    for fname in files:
                        if fname.endswith(".json"):
                            json_path = os.path.join(root, fname)
                            try:
                                with open(json_path, "r", encoding="utf-8") as f:
                                    info = json.load(f)
                                result["metadata"] = info
                                result["title"] = (
                                    info.get("title")
                                    or info.get("caption")
                                    or info.get("description")
                                )
                                result["description"] = (
                                    info.get("description") or info.get("caption")
                                )
                                tags = info.get("tags", [])
                                if isinstance(tags, dict):
                                    tag_list = []
                                    for cat_tags in tags.values():
                                        if isinstance(cat_tags, list):
                                            tag_list.extend(cat_tags)
                                        else:
                                            tag_list.append(str(cat_tags))
                                    result["tags"] = tag_list
                                elif isinstance(tags, list):
                                    result["tags"] = [str(t) for t in tags]
                                if "url" in info:
                                    result["image_urls"].append(info["url"])
                                break
                            except Exception:
                                pass
                    if result["metadata"]:
                        break

        except Exception as exc:
            logger.error("gallery-dl DownloadJob failed for %s: %s", url, exc)

    return result
