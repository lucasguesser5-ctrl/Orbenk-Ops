"""Schemas Pydantic — Ocorrência, Testemunha, Imagem."""
from datetime import date, datetime
from pydantic import BaseModel
from .user import UserResponse


# ─────────────────────────────────────────
# Testemunha
# ─────────────────────────────────────────

class WitnessCreate(BaseModel):
    name: str = ""
    phone: str = ""
    document: str = ""


class WitnessResponse(BaseModel):
    id: int
    name: str
    phone: str
    document: str

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────
# Imagem
# ─────────────────────────────────────────

class OccurrenceImageResponse(BaseModel):
    id: int
    filename: str
    original_name: str
    file_size: int
    uploaded_at: datetime
    url: str  # campo calculado

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────
# Ocorrência — Create / Update
# ─────────────────────────────────────────

class OccurrenceCreate(BaseModel):
    protocol: str | None = None          # auto-gerado se não informado
    shift: str = ""
    client: str = ""
    city: str = "Joinville, SC"
    address: str = ""
    lat: float | None = None
    lon: float | None = None
    contact_name: str = ""
    contact_phone: str = ""
    occurrence_date: date | None = None
    occurrence_time: str = ""
    contracted_services: list[str] = []
    occurrence_types: list[str] = []
    authorities: list[str] = []
    alarm_triggered: bool = False
    alarm_trigger_time: str = ""
    attendant_arrival_time: str = ""
    total_attendance_time: str = ""
    alarm_status: str = ""
    alarm_zone: str = ""
    had_victims: bool = False
    victim_count: int = 0
    victim_severity: str = ""
    had_fatalities: bool = False
    fatality_count: int = 0
    victim_details: list[dict] = []
    guard_on_site: bool = False
    guard_count: int = 0
    guard_name: str = ""
    guard_surrendered: bool = False
    guard_assaulted: bool = False
    guard_injury_severity: str = ""
    guard_weapon_fired: bool = False
    weapon_stolen: bool = False
    weapon_stolen_details: str | None = None
    vest_stolen: bool = False
    crime_scene_preserved: bool = False
    forensic_team_called: bool = False
    police_station: str = ""
    police_officer: str = ""
    legal_custody_notes: str | None = None
    damage_description: str | None = None
    bo_number: str = ""
    narrative: str | None = None
    status: str = "em_andamento"
    witnesses: list[WitnessCreate] = []


class OccurrenceUpdate(BaseModel):
    shift: str | None = None
    client: str | None = None
    city: str | None = None
    address: str | None = None
    lat: float | None = None
    lon: float | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    occurrence_date: date | None = None
    occurrence_time: str | None = None
    contracted_services: list[str] | None = None
    occurrence_types: list[str] | None = None
    authorities: list[str] | None = None
    alarm_triggered: bool | None = None
    alarm_trigger_time: str | None = None
    attendant_arrival_time: str | None = None
    total_attendance_time: str | None = None
    alarm_status: str | None = None
    alarm_zone: str | None = None
    had_victims: bool | None = None
    victim_count: int | None = None
    victim_severity: str | None = None
    had_fatalities: bool | None = None
    fatality_count: int | None = None
    victim_details: list[dict] | None = None
    guard_on_site: bool | None = None
    guard_count: int | None = None
    guard_name: str | None = None
    guard_surrendered: bool | None = None
    guard_assaulted: bool | None = None
    guard_injury_severity: str | None = None
    guard_weapon_fired: bool | None = None
    weapon_stolen: bool | None = None
    weapon_stolen_details: str | None = None
    vest_stolen: bool | None = None
    crime_scene_preserved: bool | None = None
    forensic_team_called: bool | None = None
    police_station: str | None = None
    police_officer: str | None = None
    legal_custody_notes: str | None = None
    damage_description: str | None = None
    bo_number: str | None = None
    narrative: str | None = None
    status: str | None = None
    witnesses: list[WitnessCreate] | None = None


# ─────────────────────────────────────────
# Ocorrência — Response
# ─────────────────────────────────────────

class OccurrenceResponse(BaseModel):
    id: int
    protocol: str
    shift: str
    client: str
    city: str
    address: str
    lat: float | None
    lon: float | None
    contact_name: str
    contact_phone: str
    occurrence_date: date | None
    occurrence_time: str
    contracted_services: list[str]
    occurrence_types: list[str]
    authorities: list[str]
    alarm_triggered: bool
    alarm_trigger_time: str
    attendant_arrival_time: str
    total_attendance_time: str
    alarm_status: str
    alarm_zone: str
    had_victims: bool
    victim_count: int
    victim_severity: str
    had_fatalities: bool
    fatality_count: int
    victim_details: list[dict]
    guard_on_site: bool
    guard_count: int
    guard_name: str
    guard_surrendered: bool
    guard_assaulted: bool
    guard_injury_severity: str
    guard_weapon_fired: bool
    weapon_stolen: bool
    weapon_stolen_details: str | None
    vest_stolen: bool
    crime_scene_preserved: bool
    forensic_team_called: bool
    police_station: str
    police_officer: str
    legal_custody_notes: str | None
    damage_description: str | None
    bo_number: str
    narrative: str | None
    status: str
    created_at: datetime
    updated_at: datetime
    operator: UserResponse | None
    witnesses: list[WitnessResponse]
    images: list[OccurrenceImageResponse]

    model_config = {"from_attributes": True}


class OccurrenceListItem(BaseModel):
    """Versão resumida para listagem."""
    id: int
    protocol: str
    client: str
    city: str
    address: str
    occurrence_date: date | None
    occurrence_time: str
    occurrence_types: list[str]
    status: str
    created_at: datetime
    operator: UserResponse | None

    model_config = {"from_attributes": True}


class PaginatedOccurrences(BaseModel):
    items: list[OccurrenceListItem]
    total: int
    page: int
    limit: int
    pages: int
