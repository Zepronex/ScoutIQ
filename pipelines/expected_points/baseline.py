"""Comparison baseline: a player's recent points average, with no fitting."""
from __future__ import annotations

from typing import Any

JsonObject = dict[str, Any]


def simple_recent_average_prediction(row: JsonObject) -> float:
    for column in ('rolling_points_average', 'recent_points_average', 'form'):
        value = row.get(column)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return max(0.0, float(value))
    return 0.0
