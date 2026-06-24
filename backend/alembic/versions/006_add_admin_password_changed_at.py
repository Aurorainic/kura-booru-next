"""Add password_changed_at to admins table.

Revision ID: 006_add_admin_password_changed_at
Revises: 005_add_tag_fields_and_knowledge
Create Date: 2026-06-24 12:00:00.000000

- Adds password_changed_at column (nullable) to admins table
- NULL means the admin has never changed their password (all sessions valid)
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "006_add_admin_password_changed_at"
down_revision: Union[str, None] = "005_add_tag_fields_and_knowledge"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "admins",
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("admins", "password_changed_at")
