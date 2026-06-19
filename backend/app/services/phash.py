"""Perceptual hash service for image deduplication.

Uses imagehash for phash computation and a prefix-bucket strategy
for O(1) duplicate detection instead of O(n) full-scan comparison.

v1 lesson: O(n) phash scanning was slow — prefix-bucket indexing makes
duplicate lookups effectively O(1) by matching only the first 16 bits.
"""

from __future__ import annotations

import logging
from io import BytesIO
from typing import Optional

import imagehash
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.post import Post

logger = logging.getLogger(__name__)

# Number of prefix bits used for bucket matching (first 16 bits = 4 hex chars)
PREFIX_BITS = 16
PREFIX_LENGTH = PREFIX_BITS // 4  # 4 hex characters


def compute_phash(image_bytes: bytes, hash_size: int = 16) -> str:
    """Compute a perceptual hash from raw image bytes.

    Returns a 64-character hex string for hash_size=16 (256 bits).
    """
    img = Image.open(BytesIO(image_bytes))
    phash = imagehash.phash(img, hash_size=hash_size)
    # Store as hex string — 256 bits = 64 hex chars, fits VARCHAR(64)
    return str(phash)


def _phash_to_binary_str(phash: imagehash.ImageHash) -> str:
    """Convert an imagehash object to a binary string (for internal use)."""
    flat = phash.hash.flatten()
    return "".join("1" if bit else "0" for bit in flat)


def get_phash_prefix(phash_str: str) -> str:
    """Extract the prefix bucket from a phash hex string.

    The first 4 hex chars represent 16 bits — used for fast prefix lookup.
    """
    return phash_str[:PREFIX_LENGTH]


def hamming_distance(hash1: str, hash2: str) -> int:
    """Compute the Hamming distance between two hex phash strings."""
    if len(hash1) != len(hash2):
        raise ValueError("Hash strings must be the same length")
    dist = 0
    for c1, c2 in zip(hash1, hash2):
        b1 = int(c1, 16)
        b2 = int(c2, 16)
        dist += (b1 ^ b2).bit_count()
    return dist


async def find_duplicate(
    db: AsyncSession,
    phash_str: str,
    threshold: int = 10,
) -> Optional[Post]:
    """Check if an image with a similar phash already exists in the database.

    Strategy: prefix-bucket matching — only compare against images whose
    phash shares the same first 16 bits. This reduces the search space
    dramatically.

    Args:
        db: Async database session.
        phash_str: 64-char binary phash string of the new image.
        threshold: Maximum Hamming distance to consider as duplicate.

    Returns:
        The existing Post if a duplicate is found, None otherwise.
    """
    prefix = get_phash_prefix(phash_str)

    # Query posts with matching prefix bucket
    stmt = select(Post).where(Post.phash.startswith(prefix))
    result = await db.execute(stmt)
    candidates = result.scalars().all()

    for candidate in candidates:
        dist = hamming_distance(phash_str, candidate.phash)
        if dist <= threshold:
            logger.info(
                "Duplicate found: post %s (distance=%d)", candidate.id, dist
            )
            return candidate

    return None