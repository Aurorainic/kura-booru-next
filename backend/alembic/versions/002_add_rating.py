"""Add rating column to posts (safe/questionable/explicit).

Revision ID: 002_add_rating
Revises: 001_initial
Create Date: 2026-06-20 00:00:00.000000

Adds a content rating enum and column to the posts table, aligned with
Danbooru's rating system. Existing posts default to "safe" (public), since
no rating concept existed before this migration.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002_add_rating"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── rating enum ───────────────────────────────────────────────────
    rating_enum = postgresql.ENUM(
        "safe", "questionable", "explicit",
        name="rating_enum",
        create_type=True,
    )
    rating_enum.create(op.get_bind(), checkfirst=True)

    # ── posts.rating column ───────────────────────────────────────────
    # Default "safe" so all historical posts remain public (no prior rating
    # concept existed). Not nullable once backfilled.
    op.add_column(
        "posts",
        sa.Column(
            "rating",
            rating_enum,
            nullable=False,
            server_default="safe",
        ),
    )

    # Index for the high-frequency "anonymous visitors see only safe" filter.
    op.create_index("ix_posts_rating", "posts", ["rating"])


def downgrade() -> None:
    op.drop_index("ix_posts_rating", table_name="posts")
    op.drop_column("posts", "rating")
    op.execute("DROP TYPE IF EXISTS rating_enum")
