import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.tag import TagCategory


class TagKnowledgeSource(str, enum.Enum):
    ai = "ai"
    manual = "manual"
    danbooru_import = "danbooru_import"
    danbooru_api = "danbooru_api"


class TagKnowledge(Base):
    __tablename__ = "tag_knowledge"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    name: Mapped[str] = mapped_column(
        String, unique=True, nullable=False, index=True
    )
    danbooru_name: Mapped[str | None] = mapped_column(String, nullable=True)
    type: Mapped[TagCategory] = mapped_column(
        # Reuse the same enum type already created for tags.category
        String,
        nullable=False,
    )
    translation: Mapped[str | None] = mapped_column(String, nullable=True)
    source: Mapped[str] = mapped_column(
        String, nullable=False, server_default="ai"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
