"""Models SQLAlchemy — Ocorrência, Imagem de Ocorrência."""
from datetime import date, datetime, timezone
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class Occurrence(Base):
    """Representa um registro de ocorrência pós-trauma."""

    __tablename__ = "occurrences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    protocol: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)

    # Operador responsável
    operator_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    shift: Mapped[str] = mapped_column(String(20), default="")  # Diurno | Noturno

    # Cliente e Localização
    client: Mapped[str] = mapped_column(String(200), default="")
    city: Mapped[str] = mapped_column(String(100), default="Joinville, SC")
    address: Mapped[str] = mapped_column(String(500), default="")
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    contact_name: Mapped[str] = mapped_column(String(120), default="")
    contact_phone: Mapped[str] = mapped_column(String(30), default="")

    # Data e Hora
    occurrence_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    occurrence_time: Mapped[str] = mapped_column(String(10), default="")

    # Serviços e Classificação (listas JSON)
    contracted_services: Mapped[list] = mapped_column(JSON, default=list)
    occurrence_types: Mapped[list] = mapped_column(JSON, default=list)
    authorities: Mapped[list] = mapped_column(JSON, default=list)

    # Alarme
    alarm_triggered: Mapped[bool] = mapped_column(Boolean, default=False)
    alarm_trigger_time: Mapped[str] = mapped_column(String(10), default="")
    attendant_arrival_time: Mapped[str] = mapped_column(String(10), default="")
    total_attendance_time: Mapped[str] = mapped_column(String(20), default="")
    alarm_status: Mapped[str] = mapped_column(String(20), default="")  # Armado | Desarmado
    alarm_zone: Mapped[str] = mapped_column(String(100), default="")

    # Vítimas (Mapeamento Clínico e Quantificação)
    had_victims: Mapped[bool] = mapped_column(Boolean, default=False)
    victim_count: Mapped[int] = mapped_column(Integer, default=0)
    victim_severity: Mapped[str] = mapped_column(String(50), default="")  # Leve | Moderada | Grave | Óbito
    had_fatalities: Mapped[bool] = mapped_column(Boolean, default=False)
    fatality_count: Mapped[int] = mapped_column(Integer, default=0)
    victim_details: Mapped[list] = mapped_column(JSON, default=list)  # Lista com detalhamento por vítima

    # Segurança Patrimonial — Vigilante(s) no Posto
    guard_on_site: Mapped[bool] = mapped_column(Boolean, default=False)
    guard_count: Mapped[int] = mapped_column(Integer, default=0)
    guard_name: Mapped[str] = mapped_column(String(200), default="")
    guard_surrendered: Mapped[bool] = mapped_column(Boolean, default=False)
    guard_assaulted: Mapped[bool] = mapped_column(Boolean, default=False)
    guard_injury_severity: Mapped[str] = mapped_column(String(50), default="")  # Ileso | Lesão Leve | Lesão Grave | Óbito em Serviço
    guard_weapon_fired: Mapped[bool] = mapped_column(Boolean, default=False)  # Troca de tiros / Disparos
    weapon_stolen: Mapped[bool] = mapped_column(Boolean, default=False)  # Subtração de armamento (Lei 7.102/83)
    weapon_stolen_details: Mapped[str | None] = mapped_column(String(300), nullable=True)  # Calibre, Nº Série, Qtd munições
    vest_stolen: Mapped[bool] = mapped_column(Boolean, default=False)  # Subtração de colete balístico

    # Amparo Jurídico & Perícia Técnica (CPP Arts. 6º e 158-A)
    crime_scene_preserved: Mapped[bool] = mapped_column(Boolean, default=False)  # Preservação de local
    forensic_team_called: Mapped[bool] = mapped_column(Boolean, default=False)  # Polícia Científica / IGP acionada
    police_station: Mapped[str] = mapped_column(String(120), default="")  # Delegacia de circunscrição
    police_officer: Mapped[str] = mapped_column(String(120), default="")  # Autoridade policial / Viatura responsável
    legal_custody_notes: Mapped[str | None] = mapped_column(Text, nullable=True)  # Cadeia de custódia preliminar

    # Danos e Relato
    damage_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    bo_number: Mapped[str] = mapped_column(String(50), default="")
    narrative: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(30), default="em_andamento")
    # Valores: em_andamento | concluida | arquivada

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relacionamentos
    operator: Mapped["models.user.User | None"] = relationship("User", back_populates="occurrences")
    witnesses: Mapped[list["Witness"]] = relationship(
        "Witness", back_populates="occurrence", cascade="all, delete-orphan"
    )
    images: Mapped[list["OccurrenceImage"]] = relationship(
        "OccurrenceImage", back_populates="occurrence", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Occurrence id={self.id} protocol={self.protocol!r} status={self.status!r}>"


class OccurrenceImage(Base):
    """Imagem/evidência fotográfica anexada a uma ocorrência."""

    __tablename__ = "occurrence_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    occurrence_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("occurrences.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)      # nome salvo no disco
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)  # nome original
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    occurrence: Mapped[Occurrence] = relationship("Occurrence", back_populates="images")
