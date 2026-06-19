"""Re-categorize existing tags based on heuristics and source metadata.

Usage:
    docker exec kura-backend python /app/scripts/recategorize_tags.py

This script:
1. Fetches Pixiv metadata for each post to get artist names
2. Applies heuristics to categorize existing tags
3. Updates tag categories in the database
"""

import asyncio
import json
import re
import sys

sys.path.insert(0, "/app")

from sqlalchemy import select
from app.database import async_session_factory
from app.models.post import Post
from app.models.tag import Tag, TagCategory
from app.models.post_tag import PostTag

# Meta tag patterns (these are Pixiv popularity tags, not content tags)
META_PATTERNS = [
    re.compile(r".*users入り$", re.IGNORECASE),
    re.compile(r"^\d+users入り$", re.IGNORECASE),
]

# Known character names (curated from common anime/VTuber characters)
KNOWN_CHARACTERS = {
    "神楽坂レイナ",
    "雪見ゆら",
}

# Known copyrights (event names, series names, etc.)
KNOWN_COPYRIGHTS = {
    "c91",
    "c92",
    "c93",
    "c94",
    "c95",
    "c96",
    "c97",
    "c98",
    "c99",
    "c100",
    "c101",
    "c102",
    "c103",
    "c104",
    "c105",
    "c106",
    "c107",
    "c108",
    "c109",
    "c110",
    "天使界隈",
    "バーチャルライバー",
    "vliver",
}


def categorize_tag(name: str, artist_names: set[str]) -> TagCategory:
    """Apply heuristics to categorize a tag.

    Args:
        name: Tag name (lowercase).
        artist_names: Set of known artist names from source metadata.

    Returns:
        TagCategory enum value.
    """
    name_lower = name.lower().strip()

    # Artist names from source metadata
    if name_lower in artist_names:
        return TagCategory.artist

    # Meta tags (popularity milestones)
    for pattern in META_PATTERNS:
        if pattern.match(name):
            return TagCategory.meta

    # Known copyrights
    if name_lower in KNOWN_COPYRIGHTS:
        return TagCategory.copyright

    # Known characters
    if name in KNOWN_CHARACTERS:
        return TagCategory.character

    # Default to general
    return TagCategory.general


async def fetch_pixiv_artists() -> dict[str, set[str]]:
    """Fetch artist names for each Pixiv post.

    Returns:
        Dict mapping source_id to set of artist names.
    """
    import io
    import gallery_dl
    import gallery_dl.job
    from app.services.gallery_dl import setup_gallery_dl_config

    setup_gallery_dl_config()

    artists: dict[str, set[str]] = {}

    async with async_session_factory() as db:
        posts = (await db.execute(
            select(Post).where(Post.source_site == "pixiv")
        )).scalars().all()

        for post in posts:
            url = post.source_url
            print(f"Fetching metadata for {url}...")

            try:
                buf = io.StringIO()
                data_job = gallery_dl.job.DataJob(url, file=buf, resolve=True)
                data_job.run()
                buf.seek(0)
                raw = buf.read()

                if raw:
                    items = json.loads(raw)
                    for item in items:
                        if len(item) >= 3 and item[0] == gallery_dl.job.Message.Url:
                            meta = item[2]
                            user = meta.get("user", {})
                            if isinstance(user, dict):
                                artist_name = user.get("name")
                                if artist_name:
                                    artists.setdefault(post.source_id, set()).add(
                                        artist_name.lower()
                                    )
                                    print(f"  → Artist: {artist_name}")
                            break
            except Exception as e:
                print(f"  → Failed: {e}")

    return artists


async def recategorize():
    """Re-categorize all existing tags."""
    print("=== Fetching Pixiv artist metadata ===")
    post_artists = await fetch_pixiv_artists()

    # Collect all known artist names
    all_artists = set()
    for names in post_artists.values():
        all_artists.update(names)
    print(f"\nKnown artists: {all_artists}")

    print("\n=== Re-categorizing tags ===")
    async with async_session_factory() as db:
        tags = (await db.execute(select(Tag))).scalars().all()

        updated = 0
        unchanged = 0

        for tag in tags:
            new_category = categorize_tag(tag.name, all_artists)

            if tag.category != new_category:
                old_cat = tag.category.value
                tag.category = new_category
                print(f"  {tag.name}: {old_cat} → {new_category.value}")
                updated += 1
            else:
                unchanged += 1

        await db.commit()
        print(f"\n=== Summary ===")
        print(f"Updated: {updated} tags")
        print(f"Unchanged: {unchanged} tags")
        print(f"Total: {len(tags)} tags")


if __name__ == "__main__":
    asyncio.run(recategorize())
