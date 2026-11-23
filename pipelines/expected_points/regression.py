"""Ridge regression for expected points, seeded with a prior-season fit.

The model is a plain linear regression over a handful of pre-deadline features.
Fitting needs only the normal-equation sums (X'X and X'y), so a previous season
can be carried as those sums instead of as raw rows. Adding the stored sums to
the current season's sums is the same as training on both seasons together.
That keeps early gameweeks, where a player has little or no history, anchored
to how points behaved last season.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

from pipelines.expected_points import MODEL_VERSION
from pipelines.expected_points.baseline import simple_recent_average_prediction
from pipelines.expected_points.features import (
    PREDICTION_FEATURE_COLUMNS,
    validate_prediction_feature_row,
    validate_training_feature_row,
)

JsonObject = dict[str, Any]

FEATURE_NAMES: tuple[str, ...] = (
    'intercept',
    'recent_points',
    'season_points',
    'recent_minutes_share',
    'season_minutes_share',
    'fixture_ease',
    'home',
    'position_def',
    'position_mid',
    'position_fwd',
    'price',
)

# Source columns behind FEATURE_NAMES, recorded on every prediction row.
MODEL_FEATURE_COLUMNS: tuple[str, ...] = (
    'rolling_points_average',
    'season_points_average',
    'rolling_minutes_average',
    'season_minutes_average',
    'fixture_difficulty',
    'home_away',
    'position',
    'price',
    'availability_status',
    'chance_of_playing_next_round',
)

RIDGE_PENALTY = 1.0
DEFAULT_PRIOR_PATH = Path(__file__).with_name('priors') / 'season_2025_26.json'


@dataclass(frozen=True)
class SufficientStatistics:
    """X'X, X'y and the row count for a set of training rows."""

    xtx: list[list[float]]
    xty: list[float]
    row_count: int

    @classmethod
    def empty(cls) -> 'SufficientStatistics':
        size = len(FEATURE_NAMES)
        return cls([[0.0] * size for _ in range(size)], [0.0] * size, 0)

    @classmethod
    def from_rows(cls, rows: Sequence[JsonObject]) -> 'SufficientStatistics':
        size = len(FEATURE_NAMES)
        xtx = [[0.0] * size for _ in range(size)]
        xty = [0.0] * size
        for row in rows:
            vector = design_vector(row)
            target = float(row['target_points'])
            for i, left in enumerate(vector):
                if left == 0.0:
                    continue
                xty[i] += left * target
                xtx_row = xtx[i]
                for j, right in enumerate(vector):
                    xtx_row[j] += left * right
        return cls(xtx, xty, len(rows))

    def plus(self, other: 'SufficientStatistics', weight: float = 1.0) -> 'SufficientStatistics':
        return SufficientStatistics(
            [[a + weight * b for a, b in zip(left, right)] for left, right in zip(self.xtx, other.xtx)],
            [a + weight * b for a, b in zip(self.xty, other.xty)],
            self.row_count + other.row_count,
        )


@dataclass(frozen=True)
class SeasonPrior:
    season: str
    statistics: SufficientStatistics

    def to_dict(self) -> JsonObject:
        return {
            'season': self.season,
            'feature_names': list(FEATURE_NAMES),
            'row_count': self.statistics.row_count,
            'xtx': [[round(value, 6) for value in row] for row in self.statistics.xtx],
            'xty': [round(value, 6) for value in self.statistics.xty],
        }


def load_prior(path: str | Path | None = DEFAULT_PRIOR_PATH) -> SeasonPrior | None:
    """Read stored prior-season sums. A missing or mismatched file means no prior."""
    if path is None:
        return None
    prior_path = Path(path)
    if not prior_path.exists():
        return None
    value = json.loads(prior_path.read_text(encoding='utf-8'))
    if tuple(value.get('feature_names', ())) != FEATURE_NAMES:
        return None
    size = len(FEATURE_NAMES)
    xtx = [[float(cell) for cell in row] for row in value['xtx']]
    xty = [float(cell) for cell in value['xty']]
    if len(xtx) != size or any(len(row) != size for row in xtx) or len(xty) != size:
        raise ValueError(f'{prior_path} does not match the model feature count')
    return SeasonPrior(str(value['season']), SufficientStatistics(xtx, xty, int(value['row_count'])))


@dataclass(frozen=True)
class ExpectedPointsModel:
    coefficients: dict[str, float] = field(default_factory=dict)
    model_version: str = MODEL_VERSION
    training_row_count: int = 0
    trained_from_gameweek: int | None = None
    trained_through_gameweek: int | None = None
    prior_season: str | None = None
    prior_row_count: int = 0

    @classmethod
    def fit(
        cls,
        rows: Sequence[JsonObject],
        *,
        prior: SeasonPrior | None = None,
    ) -> 'ExpectedPointsModel':
        if not rows and prior is None:
            raise ValueError('Cannot train the expected-points model without rows or a prior season')

        for row in rows:
            validate_training_feature_row(row)

        statistics = SufficientStatistics.from_rows(rows)
        if prior is not None:
            statistics = statistics.plus(prior.statistics)

        weights = solve_ridge(statistics, RIDGE_PENALTY)
        gameweeks = sorted({int(row['upcoming_gameweek_id']) for row in rows})
        return cls(
            coefficients={name: round(weight, 6) for name, weight in zip(FEATURE_NAMES, weights)},
            training_row_count=len(rows),
            trained_from_gameweek=gameweeks[0] if gameweeks else None,
            trained_through_gameweek=gameweeks[-1] if gameweeks else None,
            prior_season=prior.season if prior else None,
            prior_row_count=prior.statistics.row_count if prior else 0,
        )

    @classmethod
    def from_dict(cls, value: JsonObject) -> 'ExpectedPointsModel':
        coefficients = {str(name): float(weight) for name, weight in dict(value.get('coefficients') or {}).items()}
        if set(coefficients) != set(FEATURE_NAMES):
            raise ValueError(
                'Model artifact does not match this model version. Run model:train to rebuild it.'
            )
        return cls(
            coefficients=coefficients,
            model_version=str(value.get('model_version', MODEL_VERSION)),
            training_row_count=int(value.get('training_row_count', 0)),
            trained_from_gameweek=optional_int(value.get('trained_from_gameweek')),
            trained_through_gameweek=optional_int(value.get('trained_through_gameweek')),
            prior_season=value.get('prior_season'),
            prior_row_count=int(value.get('prior_row_count', 0)),
        )

    def to_dict(self) -> JsonObject:
        return {
            'model_version': self.model_version,
            'coefficients': self.coefficients,
            'training_row_count': self.training_row_count,
            'trained_from_gameweek': self.trained_from_gameweek,
            'trained_through_gameweek': self.trained_through_gameweek,
            'prior_season': self.prior_season,
            'prior_row_count': self.prior_row_count,
            'ridge_penalty': RIDGE_PENALTY,
            'feature_columns': list(MODEL_FEATURE_COLUMNS),
        }

    def predict_row(self, row: JsonObject) -> JsonObject:
        prediction_row = {column: row[column] for column in PREDICTION_FEATURE_COLUMNS}
        validate_prediction_feature_row(prediction_row)
        fitted = sum(
            self.coefficients[name] * value
            for name, value in zip(FEATURE_NAMES, design_vector(prediction_row))
        )
        expected_points = max(0.0, fitted) * availability_factor(prediction_row)
        return {
            'player_id': int(prediction_row['player_id']),
            'player_name': prediction_row['player_name'],
            'position': prediction_row['position'],
            'team_id': int(prediction_row['team_id']),
            'team_name': prediction_row['team_name'],
            'price': float(prediction_row['price']),
            'fixture_id': int(prediction_row['fixture_id']),
            'opponent_team_id': int(prediction_row['opponent_team_id']),
            'opponent_team': prediction_row['opponent_team'],
            'fixture_difficulty': int(prediction_row['fixture_difficulty']),
            'home_away': prediction_row['home_away'],
            'upcoming_gameweek_id': int(prediction_row['upcoming_gameweek_id']),
            'expected_points': round(expected_points, 4),
            'baseline_expected_points': round(simple_recent_average_prediction(prediction_row), 4),
            'model_version': self.model_version,
            'source_snapshot_hash': prediction_row['source_snapshot_hash'],
            'source_generated_at': prediction_row['source_generated_at'],
            'feature_columns': list(MODEL_FEATURE_COLUMNS),
        }

    def predict(self, rows: Sequence[JsonObject]) -> list[JsonObject]:
        return [self.predict_row(row) for row in rows]


def design_vector(row: JsonObject) -> list[float]:
    position = row['position']
    return [
        1.0,
        number(row, 'rolling_points_average', 'recent_points_average', 'form'),
        number(row, 'season_points_average', 'points_per_game'),
        minutes_share(number(row, 'rolling_minutes_average', 'season_minutes_average')),
        minutes_share(number(row, 'season_minutes_average')),
        float(3 - int(row['fixture_difficulty'])),
        1.0 if row['home_away'] == 'H' else 0.0,
        1.0 if position == 'DEF' else 0.0,
        1.0 if position == 'MID' else 0.0,
        1.0 if position == 'FWD' else 0.0,
        float(row['price']),
    ]


def minutes_share(average_minutes: float) -> float:
    return max(0.0, min(1.0, average_minutes / 90.0))


def availability_factor(row: JsonObject) -> float:
    """Scale by the published chance of playing. History rows carry no flag and stay at 1."""
    chance = row.get('chance_of_playing_next_round')
    if isinstance(chance, (int, float)) and not isinstance(chance, bool):
        return max(0.0, min(1.0, float(chance) / 100.0))
    status = row.get('availability_status')
    if status in {'a', 'unknown'}:
        return 1.0
    if status == 'd':
        return 0.5
    return 0.0


def solve_ridge(statistics: SufficientStatistics, penalty: float) -> list[float]:
    """Solve (X'X + penalty * I) w = X'y, leaving the intercept unpenalised."""
    size = len(FEATURE_NAMES)
    matrix = [row[:] + [statistics.xty[index]] for index, row in enumerate(statistics.xtx)]
    for index in range(1, size):
        matrix[index][index] += penalty

    for column in range(size):
        pivot = max(range(column, size), key=lambda candidate: abs(matrix[candidate][column]))
        if abs(matrix[pivot][column]) < 1e-12:
            raise ValueError('Training rows do not determine the expected-points model')
        matrix[column], matrix[pivot] = matrix[pivot], matrix[column]
        divisor = matrix[column][column]
        matrix[column] = [value / divisor for value in matrix[column]]
        for other in range(size):
            factor = matrix[other][column]
            if other != column and factor:
                matrix[other] = [value - factor * base for value, base in zip(matrix[other], matrix[column])]

    return [matrix[index][size] for index in range(size)]


def number(row: JsonObject, *columns: str) -> float:
    for column in columns:
        value = row.get(column)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    return 0.0


def optional_int(value: Any) -> int | None:
    return None if value is None else int(value)
