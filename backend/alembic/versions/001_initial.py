"""Initial migration — create all tables with proper indexes.

Revision ID: 001_initial
Revises: -
Create Date: 2024-01-01 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Enable uuid-ossp extension ────────────────────────────────────
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

    # ── Source site enum ───────────────────────────────────────────────
    source_site_enum = postgresql.ENUM(
        "pixiv", "twitter", "danbooru", "other",
        name="source_site_enum",
        create_type=True,
    )
    source_site_enum.create(op.get_bind(), checkfirst=True)

    # ── Tag category enum ──────────────────────────────────────────────
    tag_category_enum = postgresql.ENUM(
        "artist", "character", "copyright", "general", "meta",
        name="tag_category_enum",
        create_type=True,
    )
    tag_category_enum.create(op.get_bind(), checkfirst=True)

    # ── posts table ────────────────────────────────────────────────────
    op.create_table(
        "posts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column("s3_key", sa.String(), nullable=False),
        sa.Column("thumb_key", sa.String(), nullable=False),
        sa.Column("preview_key", sa.String(), nullable=False),
        sa.Column("source_url", sa.String(), nullable=False),
        sa.Column("source_site", source_site_enum, nullable=False),
        sa.Column("source_id", sa.String(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("mime_type", sa.String(), nullable=False),
        sa.Column("phash", sa.String(64), nullable=False),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # ── posts indexes ─────────────────────────────────────────────────
    op.create_index("ix_posts_source_site", "posts", ["source_site"])
    op.create_index("ix_posts_source_id", "posts", ["source_id"])
    op.create_index("ix_posts_created_at", "posts", ["created_at"])
    op.create_index("ix_posts_phash", "posts", ["phash"])
    # Composite index for looking up posts by site + id
    op.create_index(
        "ix_posts_source_site_id", "posts", ["source_site", "source_id"]
    )

    # ── tags table ─────────────────────────────────────────────────────
    op.create_table(
        "tags",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("category", tag_category_enum, nullable=False),
        sa.Column("post_count", sa.Integer(), nullable=False, server_default="0"),
    )

    # ── tags indexes ──────────────────────────────────────────────────
    op.create_index("ix_tags_name", "tags", ["name"], unique=True)
    op.create_index("ix_tags_category", "tags", ["category"])

    # ── post_tags association table ────────────────────────────────────
    op.create_table(
        "post_tags",
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("posts.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.UniqueConstraint("post_id", "tag_id", name="uq_post_tag"),
    )

    # ── post_tags indexes ──────────────────────────────────────────────
    op.create_index("ix_post_tags_post_id", "post_tags", ["post_id"])
    op.create_index("ix_post_tags_tag_id", "post_tags", ["tag_id"])

    # ── tag_aliases table ──────────────────────────────────────────────
    op.create_table(
        "tag_aliases",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column("alias_name", sa.String(), nullable=False, unique=True),
        sa.Column(
            "tag_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )

    # ── tag_aliases indexes ───────────────────────────────────────────
    op.create_index("ix_tag_aliases_alias_name", "tag_aliases", ["alias_name"], unique=True)


def downgrade() -> None:
    op.drop_table("tag_aliases")
    op.drop_table("post_tags")
    op.drop_table("tags")
    op.drop_table("posts")

    # Drop enums
    op.execute("DROP TYPE IF EXISTS tag_category_enum")
    op.execute("DROP TYPE IF EXISTS source_site_enum")