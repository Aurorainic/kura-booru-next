"""Add tag AI fields and tag_knowledge table.

Revision ID: 005_add_tag_fields_and_knowledge
Revises: 004_add_auto_rating_rules
Create Date: 2026-06-22 12:00:00.000000

- Adds danbooru_name, translation, ai_processed_at to tags table
- Creates tag_knowledge table (AI knowledge cache)
- Adds ai_tag_processed_at, ai_tag_status to posts table
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "005_add_tag_fields_and_knowledge"
down_revision: Union[str, None] = "004_add_auto_rating_rules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- tags table: add new columns ---
    op.add_column(
        "tags",
        sa.Column("danbooru_name", sa.String(), nullable=True),
    )
    op.add_column(
        "tags",
        sa.Column("translation", sa.String(), nullable=True),
    )
    op.add_column(
        "tags",
        sa.Column(
            "ai_processed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    # --- posts table: add AI tag status columns ---
    op.add_column(
        "posts",
        sa.Column(
            "ai_tag_processed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "posts",
        sa.Column(
            "ai_tag_status",
            sa.String(),
            nullable=False,
            server_default="pending",
        ),
    )

    # --- tag_knowledge table ---
    op.create_table(
        "tag_knowledge",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column(
            "name",
            sa.String(),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "danbooru_name",
            sa.String(),
            nullable=True,
        ),
        sa.Column(
            "type",
            sa.String(),
            nullable=False,
        ),
        sa.Column(
            "translation",
            sa.String(),
            nullable=True,
        ),
        sa.Column(
            "source",
            sa.String(),
            nullable=False,
            server_default="ai",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_index(
        "ix_tag_knowledge_name",
        "tag_knowledge",
        ["name"],
        unique=True,
    )


def downgrade() -> None:
    # --- tag_knowledge table ---
    op.drop_index("ix_tag_knowledge_name", table_name="tag_knowledge")
    op.drop_table("tag_knowledge")

    # --- posts table: drop AI tag status columns ---
    op.drop_column("posts", "ai_tag_status")
    op.drop_column("posts", "ai_tag_processed_at")

    # --- tags table: drop new columns ---
    op.drop_column("tags", "ai_processed_at")
    op.drop_column("tags", "translation")
    op.drop_column("tags", "danbooru_name")
