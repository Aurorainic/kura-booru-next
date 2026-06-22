"""Tag knowledge service — cache layer for AI tag classification results.

Provides lookup / write / batch operations for the tag_knowledge table,
which stores previously AI-processed tag data to avoid redundant API calls.
"""

import logging
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from app.database import async_session_factory
from app.models.tag import TagCategory
from app.models.tag_knowledge import TagKnowledge

logger = logging.getLogger(__name__)


async def lookup_tags(tag_names: list[str]) -> dict[str, TagKnowledge]:
    """Look up multiple tags in the knowledge base.

    Args:
        tag_names: List of tag name strings (lowercase).

    Returns:
        Dict mapping name -> TagKnowledge for all found entries.
    """
    if not tag_names:
        return {}

    async with async_session_factory() as session:
        result = await session.execute(
            select(TagKnowledge).where(TagKnowledge.name.in_(tag_names))
        )
        rows = result.scalars().all()
        return {row.name: row for row in rows}


async def upsert_tag_knowledge(
    name: str,
    tag_type: str,
    danbooru_name: str | None = None,
    translation: str | None = None,
    source: str = "ai",
) -> TagKnowledge:
    """Insert or update a single tag knowledge entry.

    Uses PostgreSQL ON CONFLICT to upsert.

    Args:
        name: Original tag name (lowercase).
        tag_type: Category string (artist/character/copyright/general/meta).
        danbooru_name: Danbooru standard name.
        translation: Chinese translation.
        source: Source of this knowledge ('ai', 'manual', etc.).

    Returns:
        The TagKnowledge row.
    """
    async with async_session_factory() as session:
        stmt = insert(TagKnowledge).values(
            name=name,
            type=tag_type,
            danbooru_name=danbooru_name,
            translation=translation,
            source=source,
        )
        # On conflict (name already exists), update all mutable fields
        stmt = stmt.on_conflict_do_update(
            index_elements=["name"],
            set_={
                "type": stmt.excluded.type,
                "danbooru_name": stmt.excluded.danbooru_name,
                "translation": stmt.excluded.translation,
                "source": stmt.excluded.source,
                "updated_at": datetime.utcnow(),
            },
        )
        await session.execute(stmt)
        await session.commit()

        # Fetch the row back
        result = await session.execute(
            select(TagKnowledge).where(TagKnowledge.name == name)
        )
        return result.scalar_one()


async def batch_upsert_tag_knowledge(
    entries: list[dict],
    source: str = "ai",
) -> None:
    """Batch insert or update tag knowledge entries.

    Args:
        entries: List of dicts with keys: name, type, danbooru_name, translation.
        source: Source for all entries.
    """
    if not entries:
        return

    async with async_session_factory() as session:
        values = [
            {
                "name": e["name"],
                "type": e["type"],
                "danbooru_name": e.get("danbooru_name"),
                "translation": e.get("translation"),
                "source": source,
            }
            for e in entries
        ]
        stmt = insert(TagKnowledge).values(values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["name"],
            set_={
                "type": stmt.excluded.type,
                "danbooru_name": stmt.excluded.danbooru_name,
                "translation": stmt.excluded.translation,
                "source": stmt.excluded.source,
                "updated_at": datetime.utcnow(),
            },
        )
        await session.execute(stmt)
        await session.commit()


async def get_unprocessed_tag_names(limit: int = 500) -> list[str]:
    """Get tag names that exist in tags table but not in tag_knowledge.

    Args:
        limit: Max number of names to return.

    Returns:
        List of tag name strings not yet in the knowledge base.
    """
    from app.models.tag import Tag

    async with async_session_factory() as session:
        # Tags not in tag_knowledge
        subq = select(TagKnowledge.name)
        result = await session.execute(
            select(Tag.name)
            .where(Tag.name.notin_(subq))
            .limit(limit)
        )
        return [row[0] for row in result.all()]


async def update_tag_knowledge_source(name: str, source: str) -> None:
    """Update the source field for a tag knowledge entry (e.g. after manual edit)."""
    async with async_session_factory() as session:
        await session.execute(
            update(TagKnowledge)
            .where(TagKnowledge.name == name)
            .values(source=source, updated_at=datetime.utcnow())
        )
        await session.commit()
