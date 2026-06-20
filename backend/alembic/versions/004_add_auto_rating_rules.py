"""Add auto_rating_rules table for tag-based auto-rating.

Revision ID: 004_add_auto_rating_rules
Revises: 003_add_admin_table
Create Date: 2026-06-20 12:00:00.000000

Creates an auto_rating_rules table mapping tag names to target ratings.
When a post is created with a tag matching a rule, the post's rating
is automatically escalated to the rule's target rating.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004_add_auto_rating_rules"
down_revision: Union[str, None] = "003_add_admin_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "auto_rating_rules",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column(
            "tag_name",
            sa.String(),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "target_rating",
            sa.Enum(
                "safe",
                "questionable",
                "explicit",
                name="rating_enum",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_index(
        "ix_auto_rating_rules_tag_name",
        "auto_rating_rules",
        ["tag_name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_auto_rating_rules_tag_name", table_name="auto_rating_rules")
    op.drop_table("auto_rating_rules")
