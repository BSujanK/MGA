"""Learning recommendations: map each skill gap to curated resources."""
from __future__ import annotations

import json
from functools import lru_cache

from ..models import Resource
from .taxonomy import DATA_DIR

_LEVEL_ORDER = {"beginner": 0, "intermediate": 1, "advanced": 2}
_COST_ORDER = {"free": 0, "freemium": 1, "paid": 2}


@lru_cache(maxsize=1)
def _catalog() -> dict[str, list[Resource]]:
    raw = json.loads((DATA_DIR / "resources.json").read_text())
    return {sid: [Resource(**r) for r in items] for sid, items in raw["resources"].items()}


def recommend(skill_id: str, current_level: float = 0.0, limit: int = 3) -> list[Resource]:
    """Pick resources that match where the candidate is now.

    Below level 2 start with beginner material; at 2-3 prefer intermediate;
    above 3 prefer advanced. Free resources rank ahead of paid at the same fit.
    """
    items = _catalog().get(skill_id, [])
    target = 0 if current_level < 2 else 1 if current_level < 3 else 2
    ranked = sorted(items, key=lambda r: (abs(_LEVEL_ORDER.get(r.level, 1) - target), _COST_ORDER.get(r.cost, 1)))
    return ranked[:limit]
