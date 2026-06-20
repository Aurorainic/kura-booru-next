"""Add admins table for database-backed admin authentication.

Revision ID: 003_add_admin_table
Revises: 002_add_rating
Create Date: 2026-06-20 12:00:00.000000

Creates an admins table storing username + bcrypt password hash.
On first startup, the application auto-creates a default admin with a
random password that is printed to the logs. After that, passwords can
be changed from the admin web UI.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003_add_admin_table"
down_revision: Union[str, None] = "002_add_rating"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admins",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            primary_key=True,
        ),
        sa.Column("username", sa.String(), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_index("ix_admins_username", "admins", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_admins_username", table_name="admins")
    op.drop_table("admins")