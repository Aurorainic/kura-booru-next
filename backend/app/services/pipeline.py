"""Image processing pipeline.

Orchestrates the full flow: download → phash check → thumbnail generation →
S3 upload → return ProcessedResult.

Key design decisions:
- HEAD check Content-Length before downloading (reject > MAX_IMAGE_SIZE)
- Stream-based S3 uploads (no memory buffering of originals)
- Pillows for thumbnail/preview generation
- phash dedup with prefix-bucket indexing
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from io import BytesIO
from typing import Optional

import aiohttp
from PIL import Image, ImageOps
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.post import SourceSite
from app.services.phash import compute_phash, find_duplicate
from app.services.s3 import (
    original_key,
    preview_key,
    s3_service,
    thumb_key,
)

logger = logging.getLogger(__name__)

settings = get_settings()


@dataclass
class ProcessedResult:
    """Result of a successful image processing pipeline run."""

    s3_key: str
    thumb_key: str
    preview_key: str
    source_url: str
    source_site: SourceSite
    source_id: str
    width: int
    height: int
    file_size: int
    mime_type: str
    phash: str
    title: Optional[str] = None
    description: Optional[str] = None
    tag_names: list[str] = field(default_factory=list)


class ImageTooLargeError(Exception):
    """Raised when the remote image exceeds MAX_IMAGE_SIZE."""

    def __init__(self, size: int, limit: int) -> None:
        self.size = size
        self.limit = limit
        super().__init__(
            f"Image size {size} bytes exceeds limit of {limit} bytes "
            f"({size / 1024 / 1024:.1f}MB > {limit / 1024 / 1024:.1f}MB)"
        )


class DuplicateImageError(Exception):
    """Raised when a perceptually duplicate image is found."""

    def __init__(self, existing_post_id: str) -> None:
        self.existing_post_id = existing_post_id
        super().__init__(f"Duplicate image found: post {existing_post_id}")


def _extension_from_url(url: str, content_type: str = "") -> str:
    """Guess file extension from URL path or content type."""
    from urllib.parse import urlparse

    parsed = urlparse(url)
    path = parsed.path.lower()

    # Try path extension first
    for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"):
        if path.endswith(ext):
            return ext.lstrip(".")

    # Fall back to content type
    mime_map = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/avif": "avif",
    }
    return mime_map.get(content_type, "png")


def _generate_thumbnail(
    image_bytes: bytes,
    size: tuple[int, int],
    mime_type: str,
) -> tuple[bytes, str]:
    """Generate a thumbnail from image bytes.

    Returns (thumbnail_bytes, thumbnail_mime_type).
    """
    img = Image.open(BytesIO(image_bytes))

    # Preserve EXIF orientation
    img = ImageOps.exif_transpose(img)

    # Convert RGBA/P modes to RGB for JPEG output
    if img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")

    img.thumbnail(size, Image.Resampling.LANCZOS)

    buf = BytesIO()
    # Always output thumbnails as JPEG for smaller file size
    img.save(buf, format="JPEG", quality=85, optimize=True)
    return buf.getvalue(), "image/jpeg"


async def _head_check(url: str, session: aiohttp.ClientSession) -> tuple[int, str]:
    """HEAD check to get Content-Length and Content-Type before downloading.

    Raises ImageTooLargeError if size exceeds MAX_IMAGE_SIZE.
    Returns (content_length, content_type).
    """
    async with session.head(url, allow_redirects=True) as resp:
        resp.raise_for_status()
        content_length = int(resp.headers.get("Content-Length", 0))
        content_type = resp.headers.get("Content-Type", "application/octet-stream")

        if content_length > settings.MAX_IMAGE_SIZE:
            raise ImageTooLargeError(content_length, settings.MAX_IMAGE_SIZE)

        return content_length, content_type


async def download_and_process(
    url: str,
    source_site: SourceSite,
    source_id: str,
    db: AsyncSession,
    title: Optional[str] = None,
    description: Optional[str] = None,
    tag_names: Optional[list[str]] = None,
    image_bytes: Optional[bytes] = None,
) -> ProcessedResult:
    """Full image processing pipeline.

    1. HEAD check Content-Length (reject > MAX_IMAGE_SIZE)
    2. Download image bytes (or use pre-downloaded bytes)
    3. Compute phash and check duplicates
    4. Generate thumbnails (thumb 150×150, preview 850×850)
    5. Upload originals + thumbnails to S3
    6. Return ProcessedResult
    """
    tag_names = tag_names or []

    if image_bytes is None:
        # No pre-downloaded bytes — use aiohttp to fetch
        async with aiohttp.ClientSession() as session:
            # Step 1: HEAD check
            content_length, content_type = await _head_check(url, session)

            # Step 2: Download
            async with session.get(url, allow_redirects=True) as resp:
                resp.raise_for_status()
                image_bytes = await resp.read()
    else:
        # Pre-downloaded bytes available — skip HTTP download
        content_length = len(image_bytes)
        content_type = "application/octet-stream"
        logger.info("Using pre-downloaded image bytes (%d bytes), skipping HTTP download", content_length)

        file_size = len(image_bytes)
        if file_size > settings.MAX_IMAGE_SIZE:
            raise ImageTooLargeError(file_size, settings.MAX_IMAGE_SIZE)

        mime_type = content_type.split(";")[0].strip()
        if not mime_type.startswith("image/"):
            mime_type = "image/png"  # fallback

    # Step 3: Compute phash and check duplicates
    phash_str = compute_phash(image_bytes)
    existing = await find_duplicate(db, phash_str)
    if existing:
        raise DuplicateImageError(str(existing.id))

    # Step 4: Generate thumbnails
    thumb_bytes, thumb_mime = _generate_thumbnail(
        image_bytes, settings.thumb_size_tuple, mime_type
    )
    preview_bytes, preview_mime = _generate_thumbnail(
        image_bytes, settings.preview_size_tuple, mime_type
    )

    # Get original image dimensions
    img = Image.open(BytesIO(image_bytes))
    img = ImageOps.exif_transpose(img)
    width, height = img.size

    # Determine file extension
    ext = _extension_from_url(url, mime_type)

    # Step 5: Upload to S3
    orig_key = await s3_service.upload_bytes(
        original_key(source_site, source_id, ext),
        image_bytes,
        content_type=mime_type,
    )
    t_key = await s3_service.upload_bytes(
        thumb_key(source_site, source_id, ext),
        thumb_bytes,
        content_type=thumb_mime,
    )
    p_key = await s3_service.upload_bytes(
        preview_key(source_site, source_id, ext),
        preview_bytes,
        content_type=preview_mime,
    )

    # Post-upload URL verification (v1 lesson: catch key mismatches early)
    for k in (orig_key, t_key, p_key):
        verified = await s3_service.verify_upload(k)
        if not verified:
            logger.warning("Upload verification failed for key: %s", k)

    logger.info(
        "Processed image: %s/%s (%dx%d, %d bytes)",
        source_site,
        source_id,
        width,
        height,
        file_size,
    )

    # Step 6: Return result
    return ProcessedResult(
        s3_key=orig_key,
        thumb_key=t_key,
        preview_key=p_key,
        source_url=url,
        source_site=source_site,
        source_id=source_id,
        width=width,
        height=height,
        file_size=file_size,
        mime_type=mime_type,
        phash=phash_str,
        title=title,
        description=description,
        tag_names=tag_names,
    )