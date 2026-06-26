"""Add settings table for DB-driven site configuration.

Revision ID: 007_add_settings
Revises: 006_add_admin_password_changed_at
Create Date: 2026-06-26 12:00:00.000000

- Creates settings table with key (PK), value, updated_at columns
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "007_add_settings"
down_revision: Union[str, None] = "006_add_admin_password_changed_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "settings",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("settings")
