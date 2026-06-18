import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TagCategory(str, enum.Enum):
    artist = "artist"
    character = "character"
    copyright = "copyright"
    general = "general"
    meta = "meta"


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    category: Mapped[TagCategory] = mapped_column(
        Enum(TagCategory, name="tag_category_enum"),
        nullable=False,
    )
    post_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relationship: posts via PostTag association table
    posts: Mapped[list["Post"]] = relationship(
        "Post",
        secondary="post_tags",
        back_populates="tags",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Tag name={self.name} category={self.category}>"