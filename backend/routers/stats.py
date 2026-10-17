"""Router — Estatísticas do sistema."""
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import require_roles
from models.occurrence import Occurrence
from schemas.stats import StatsResponse, MonthCount, ClientCount

router = APIRouter(prefix="/stats", tags=["Estatísticas"])


@router.get("/", response_model=StatsResponse)
def get_stats(
    db: Session = Depends(get_db),
    _=Depends(require_roles("supervisor", "admin")),
):
    """Retorna estatísticas consolidadas do sistema."""
    all_occs = db.query(Occurrence).all()
    today = date.today()
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)

    # Total
    total = len(all_occs)

    # Hoje
    today_count = sum(1 for o in all_occs if o.occurrence_date == today)

    # Últimos 7 dias
    recent_7 = sum(
        1 for o in all_occs
        if o.created_at and o.created_at.replace(tzinfo=timezone.utc) >= seven_days_ago
    )

    # Por status
    status_counter: dict[str, int] = Counter(o.status for o in all_occs)

    # Por tipo (cada ocorrência pode ter múltiplos tipos)
    type_counter: dict[str, int] = Counter()
    for o in all_occs:
        for t in (o.occurrence_types or []):
            type_counter[t] += 1

    # Por mês (últimos 12 meses)
    month_counter: dict[str, int] = Counter()
    cutoff = now - timedelta(days=365)
    for o in all_occs:
        if o.created_at and o.created_at.replace(tzinfo=timezone.utc) >= cutoff:
            month_key = o.created_at.strftime("%Y-%m")
            month_counter[month_key] += 1

    # Ordena e preenche meses sem dados
    months_list: list[MonthCount] = []
    for i in range(11, -1, -1):
        ref = now - timedelta(days=30 * i)
        key = ref.strftime("%Y-%m")
        months_list.append(MonthCount(month=key, count=month_counter.get(key, 0)))

    # Clientes mais afetados (top 5)
    client_counter: dict[str, int] = Counter(
        o.client for o in all_occs if o.client
    )
    top_clients = [
        ClientCount(client=c, count=n)
        for c, n in client_counter.most_common(5)
    ]

    return StatsResponse(
        total_occurrences=total,
        recent_7_days=recent_7,
        today_count=today_count,
        occurrences_by_status=dict(status_counter),
        occurrences_by_type=dict(type_counter),
        occurrences_by_month=months_list,
        most_affected_clients=top_clients,
    )
