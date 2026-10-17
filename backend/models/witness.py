"""Model SQLAlchemy — Testemunha."""
from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class Witness(Base):
    """Testemunha registrada em uma ocorrência."""

    __tablename__ = "witnesses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    occurrence_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("occurrences.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(30), default="")
    document: Mapped[str] = mapped_column(String(50), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    occurrence: Mapped["models.occurrence.Occurrence"] = relationship(
        "Occurrence", back_populates="witnesses"
    )

    def __repr__(self) -> str:
        return f"<Witness id={self.id} name={self.name!r}>"
