"""Router — Geocodificação (proxy para Nominatim)."""
from fastapi import APIRouter, Query
from services.geo_service import search_address

router = APIRouter(prefix="/geo", tags=["Geocodificação"])


@router.get("/search")
async def geo_search(
    q: str = Query(..., min_length=3, description="Termo de busca"),
    city: str = Query("Joinville, SC", description="Cidade para restringir a busca"),
):
    """
    Proxy para Nominatim (OpenStreetMap) com cache em memória.
    Evita problemas de CORS no frontend e protege o User-Agent.
    """
    results = await search_address(q, city)
    return results
