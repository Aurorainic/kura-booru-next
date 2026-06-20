import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SourceSite(str, enum.Enum):
    pixiv = "pixiv"
    twitter = "twitter"
    danbooru = "danbooru"
    other = "other"


class Rating(str, enum.Enum):
    """Post content rating, aligned with Danbooru's system.

    Visibility rules:
      - safe           → always visible (public)
      - questionable   → hidden from anonymous visitors
      - explicit       → hidden from anonymous visitors
    gallery-dl metadata (Pixiv x_restrict, Danbooru rating) auto-populates this.
    """

    safe = "safe"
    questionable = "questionable"
    explicit = "explicit"


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    s3_key: Mapped[str] = mapped_column(String, nullable=False)
    thumb_key: Mapped[str] = mapped_column(String, nullable=False)
    preview_key: Mapped[str] = mapped_column(String, nullable=False)
    source_url: Mapped[str] = mapped_column(String, nullable=False)
    source_site: Mapped[SourceSite] = mapped_column(
        Enum(SourceSite, name="source_site_enum"),
        nullable=False,
    )
    source_id: Mapped[str] = mapped_column(String, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    phash: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    rating: Mapped[Rating] = mapped_column(
        Enum(Rating, name="rating_enum"),
        nullable=False,
        server_default=Rating.safe.value,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationship: tags via PostTag association table
    tags: Mapped[list["Tag"]] = relationship(
        "Tag",
        secondary="post_tags",
        back_populates="posts",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Post id={self.id} source={self.source_site}:{self.source_id}>"