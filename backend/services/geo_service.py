"""Serviço de geocodificação via Nominatim com cache em memória."""
from collections import OrderedDict
import httpx

_CACHE: OrderedDict[str, list[dict]] = OrderedDict()
_MAX_CACHE = 200

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
HEADERS = {
    "User-Agent": "OrbenkOps/1.0 (sistema-interno)",
    "Accept-Language": "pt-BR,pt;q=0.9",
}


async def search_address(query: str, city: str = "Joinville, SC") -> list[dict]:
    """
    Busca endereços via Nominatim com cache LRU em memória.

    Args:
        query: Termo de busca (rua, número, bairro).
        city: Cidade para restringir a busca.

    Returns:
        Lista de dicts com display_name, lat, lon, place_id.
    """
    cache_key = f"{query.lower().strip()}|{city.lower().strip()}"

    if cache_key in _CACHE:
        # Move para o final (LRU)
        _CACHE.move_to_end(cache_key)
        return _CACHE[cache_key]

    full_query = f"{query}, {city}"
    params = {
        "format": "json",
        "q": full_query,
        "limit": 7,
        "addressdetails": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(NOMINATIM_URL, params=params, headers=HEADERS)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError:
        return []

    results = [
        {
            "display_name": item.get("display_name", ""),
            "lat": float(item.get("lat", 0)),
            "lon": float(item.get("lon", 0)),
            "place_id": item.get("place_id"),
        }
        for item in data
    ]

    # Armazena no cache
    _CACHE[cache_key] = results
    _CACHE.move_to_end(cache_key)
    if len(_CACHE) > _MAX_CACHE:
        _CACHE.popitem(last=False)

    return results
