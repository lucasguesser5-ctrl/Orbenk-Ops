"""Schemas Pydantic — Estatísticas."""
from pydantic import BaseModel


class MonthCount(BaseModel):
    month: str
    count: int


class ClientCount(BaseModel):
    client: str
    count: int


class StatsResponse(BaseModel):
    total_occurrences: int
    recent_7_days: int
    occurrences_by_status: dict[str, int]
    occurrences_by_type: dict[str, int]
    occurrences_by_month: list[MonthCount]
    most_affected_clients: list[ClientCount]
    today_count: int
