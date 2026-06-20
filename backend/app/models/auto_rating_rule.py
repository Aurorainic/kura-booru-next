"""Auto-rating rule model.

Maps a tag name to a target rating. When a post is created with a tag
that matches an auto-rating rule, the post's rating is automatically
escalated to the rule's target rating (if more restrictive than the
source-extracted rating).
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.post import Rating


class AutoRatingRule(Base):
    __tablename__ = "auto_rating_rules"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    tag_name: Mapped[str] = mapped_column(
        String, unique=True, nullable=False, index=True
    )
    target_rating: Mapped[Rating] = mapped_column(
        Enum(Rating, name="rating_enum"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<AutoRatingRule tag={self.tag_name} → {self.target_rating}>"
