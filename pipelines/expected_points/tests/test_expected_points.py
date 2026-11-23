from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pipelines.expected_points.regression import (
    FEATURE_NAMES,
    ExpectedPointsModel,
    SeasonPrior,
    SufficientStatistics,
    load_prior
)
from pipelines.expected_points.evaluation import calculate_prediction_metrics, split_train_test_for_gameweek
from pipelines.expected_points.features import (
    PREDICTION_FEATURE_COLUMNS,
    apply_history_form,
    build_expected_points_feature_files,
    build_historical_training_rows,
    build_prediction_feature_rows,
    discover_snapshot_dirs,
    validate_prediction_feature_row
)
from pipelines.expected_points.backtest import main as backtest_main
from pipelines.expected_points.train import main as train_main


class ExpectedPointsFoundationTests(unittest.TestCase):
    def test_prediction_feature_rows_have_model_schema_without_target(self) -> None:
        rows = build_prediction_feature_rows(snapshot_dataset(checked_gameweek=1, target_gameweek=2, total_points=5, minutes=90))

        self.assertEqual(tuple(rows[0].keys()), PREDICTION_FEATURE_COLUMNS)
        self.assertEqual(rows[0]['team_name'], 'Arsenal')
        self.assertEqual(rows[0]['season_points_average'], 5.0)
        self.assertNotIn('target_points', rows[0])
        validate_prediction_feature_row(rows[0])

    def test_historical_feature_rows_pair_exact_checked_snapshot_and_use_prior_rolling_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            write_snapshot(root / 'snapshot-1', checked_gameweek=1, target_gameweek=2, total_points=5, minutes=90)
            write_snapshot(root / 'snapshot-2', checked_gameweek=2, target_gameweek=3, total_points=12, minutes=180)
            write_snapshot(root / 'snapshot-3', checked_gameweek=3, target_gameweek=4, total_points=14, minutes=270)
            write_snapshot(root / 'snapshot-4', checked_gameweek=4, target_gameweek=5, total_points=20, minutes=360)

            rows = build_historical_training_rows(discover_snapshot_dirs(root), rolling_window=3)

        self.assertEqual([row['upcoming_gameweek_id'] for row in rows], [2, 3, 4])
        self.assertEqual([row['target_points'] for row in rows], [7, 2, 6])
        self.assertEqual(rows[0]['rolling_points_average'], 6.2)
        self.assertEqual(rows[1]['rolling_points_average'], 7.0)
        self.assertEqual(rows[2]['rolling_points_average'], 4.5)

    def test_official_history_rows_build_training_and_latest_prediction_features(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            input_dir = root / 'latest'
            write_dataset(input_dir, history_feature_dataset())
            history_path = root / 'history.json'
            history_path.write_text(f'{json.dumps(history_payload(), indent=2)}\n', encoding='utf-8')

            result = build_expected_points_feature_files(input_dir, history_path)

        self.assertEqual([row['upcoming_gameweek_id'] for row in result.training_rows], [1, 2, 3])
        self.assertEqual([row['target_points'] for row in result.training_rows], [5, 7, 2])
        self.assertEqual(result.training_rows[1]['total_points'], 5)
        self.assertEqual(result.training_rows[1]['rolling_points_average'], 5.0)
        self.assertEqual(result.prediction_source, 'latest-historical-gameweek')
        self.assertEqual(len(result.prediction_rows), 1)
        self.assertNotIn('target_points', result.prediction_rows[0])

    def test_train_test_split_excludes_target_and_future_gameweeks(self) -> None:
        rows = [
            training_row(2, target_points=7),
            training_row(3, target_points=2),
            training_row(4, target_points=6)
        ]

        train_rows, test_rows = split_train_test_for_gameweek(rows, 3)

        self.assertEqual([row['upcoming_gameweek_id'] for row in train_rows], [2])
        self.assertEqual([row['upcoming_gameweek_id'] for row in test_rows], [3])

    def test_prediction_output_schema_contains_expected_points_and_baseline(self) -> None:
        model = ExpectedPointsModel.fit(varied_training_rows(), prior=None)

        prediction = model.predict_row(training_row(4, target_points=6))

        self.assertEqual(prediction['player_id'], 1)
        self.assertEqual(prediction['upcoming_gameweek_id'], 4)
        self.assertIn('expected_points', prediction)
        self.assertEqual(prediction['baseline_expected_points'], 5.0)
        self.assertEqual(prediction['model_version'], 'expected-points-ridge-v2')

    def test_regression_recovers_a_linear_relationship(self) -> None:
        rows = [
            {**training_row(2 + index % 3, target_points=0), 'rolling_points_average': float(form),
             'price': 5.0 + index % 4, 'target_points': 1.0 + 0.5 * form + 0.25 * (5.0 + index % 4)}
            for index, form in enumerate([0, 1, 2, 3, 4, 5, 6, 7, 8, 2, 5, 1])
        ]

        model = ExpectedPointsModel.fit(rows, prior=None)
        prediction = model.predict_row({**rows[0], 'rolling_points_average': 4.0, 'price': 6.0})

        self.assertAlmostEqual(prediction['expected_points'], 1.0 + 2.0 + 1.5, delta=0.2)

    def test_prior_season_statistics_stand_in_for_missing_history(self) -> None:
        prior = SeasonPrior('2025-26', SufficientStatistics.from_rows(varied_training_rows()))

        from_prior = ExpectedPointsModel.fit([], prior=prior)
        from_rows = ExpectedPointsModel.fit(varied_training_rows(), prior=None)

        self.assertEqual(from_prior.coefficients, from_rows.coefficients)
        self.assertEqual(from_prior.training_row_count, 0)
        self.assertEqual(from_prior.prior_season, '2025-26')
        with self.assertRaisesRegex(ValueError, 'without rows or a prior'):
            ExpectedPointsModel.fit([], prior=None)

    def test_committed_prior_matches_the_model_features(self) -> None:
        prior = load_prior()

        self.assertIsNotNone(prior)
        self.assertEqual(len(prior.statistics.xtx), len(FEATURE_NAMES))
        self.assertGreater(prior.statistics.row_count, 10000)

    def test_unavailable_players_are_projected_to_zero(self) -> None:
        model = ExpectedPointsModel.fit(varied_training_rows(), prior=None)
        row = training_row(4, target_points=6)

        fit = model.predict_row({**row, 'availability_status': 'a', 'chance_of_playing_next_round': None})
        doubt = model.predict_row({**row, 'availability_status': 'd', 'chance_of_playing_next_round': 25})
        injured = model.predict_row({**row, 'availability_status': 'i', 'chance_of_playing_next_round': None})

        self.assertGreater(fit['expected_points'], 0)
        self.assertAlmostEqual(doubt['expected_points'], fit['expected_points'] * 0.25, places=3)
        self.assertEqual(injured['expected_points'], 0.0)

    def test_model_artifact_round_trips_and_rejects_older_versions(self) -> None:
        model = ExpectedPointsModel.fit(varied_training_rows(), prior=None)

        self.assertEqual(ExpectedPointsModel.from_dict(model.to_dict()), model)
        with self.assertRaisesRegex(ValueError, 'model:train'):
            ExpectedPointsModel.from_dict({'model_version': 'expected-points-rule-baseline-v1', 'global_correction': 0.1})

    def test_serving_rows_take_form_from_the_same_history_as_training_rows(self) -> None:
        row = {**training_row(4, target_points=0), 'rolling_points_average': 9.9, 'season_minutes_average': 1.0}
        del row['target_points'], row['target_minutes']

        updated = apply_history_form([row], history_payload(), rolling_window=2)[0]

        self.assertEqual(updated['completed_gameweeks'], 3)
        self.assertEqual(updated['rolling_points_average'], 4.5)
        self.assertEqual(updated['rolling_minutes_average'], 75.0)
        self.assertAlmostEqual(updated['season_points_average'], 4.6667)
        self.assertEqual(updated['season_minutes_average'], 80.0)

    def test_history_training_rows_use_the_price_before_each_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            write_dataset(root / 'latest', history_feature_dataset())
            history_path = root / 'history.json'
            history_path.write_text(json.dumps(history_payload()), encoding='utf-8')

            result = build_expected_points_feature_files(root / 'latest', history_path)

        self.assertEqual([row['price'] for row in result.training_rows], [12.5, 12.6, 12.6])

    def test_metric_calculation_reports_mae_and_rmse(self) -> None:
        metrics = calculate_prediction_metrics(
            [
                {'actual_points': 4, 'expected_points': 3, 'position': 'FWD'},
                {'actual_points': 2, 'expected_points': 5, 'position': 'FWD'}
            ],
            prediction_column='expected_points'
        )

        self.assertEqual(metrics['count'], 2)
        self.assertEqual(metrics['mae'], 2.0)
        self.assertAlmostEqual(metrics['rmse'], 2.2361)

    def test_missing_training_rows_have_actionable_train_and_backtest_errors(self) -> None:
        missing_path = 'missing-training-rows.jsonl'

        with self.assertRaisesRegex(FileNotFoundError, 'Run pnpm.cmd run ingest:fpl:history, then pnpm.cmd run pipeline:features'):
            train_main(['--input', missing_path])

        with self.assertRaisesRegex(FileNotFoundError, 'Run pnpm.cmd run ingest:fpl:history, then pnpm.cmd run pipeline:features'):
            backtest_main(['--input', missing_path])


def training_row(gameweek: int, *, target_points: int) -> dict[str, object]:
    row = build_prediction_feature_rows(snapshot_dataset(gameweek - 1, gameweek, total_points=10, minutes=180))[0]
    return {
        **row,
        'rolling_points_average': 5.0,
        'rolling_minutes_average': 90.0,
        'target_points': target_points,
        'target_minutes': 90
    }


def varied_training_rows() -> list[dict[str, object]]:
    rows = []
    for index in range(24):
        rows.append({
            **training_row(2 + index % 3, target_points=(index * 7) % 11),
            'rolling_points_average': float(index % 9),
            'season_points_average': float((index * 3) % 7),
            'rolling_minutes_average': float((index * 37) % 91),
            'season_minutes_average': float((index * 53) % 91),
            'fixture_difficulty': 2 + index % 4,
            'home_away': 'H' if index % 2 else 'A',
            'position': ('GK', 'DEF', 'MID', 'FWD')[index % 4],
            'price': 4.0 + (index * 5) % 9
        })
    return rows


def write_snapshot(path: Path, *, checked_gameweek: int, target_gameweek: int, total_points: int, minutes: int) -> None:
    dataset = snapshot_dataset(checked_gameweek, target_gameweek, total_points=total_points, minutes=minutes)
    write_dataset(path, dataset)


def write_dataset(path: Path, dataset: dict[str, object]) -> None:
    path.mkdir(parents=True)
    for file_name, value in {
        'manifest.json': dataset['manifest'],
        'players.json': dataset['players'],
        'teams.json': dataset['teams'],
        'events.json': dataset['events'],
        'fixtures.json': dataset['fixtures']
    }.items():
        (path / file_name).write_text(f'{json.dumps(value, indent=2)}\n', encoding='utf-8')


def history_payload() -> dict[str, object]:
    return {
        'schemaVersion': 1,
        'generatedAt': '2026-08-14T18:00:00.000Z',
        'source': {
            'name': 'element-summary',
            'urlTemplate': 'https://fantasy.premierleague.com/api/element-summary/{player_id}/',
            'fetchedAt': '2026-08-14T17:55:00.000Z'
        },
        'playerCount': 1,
        'rowCount': 3,
        'rows': [
            {
                'playerId': 1,
                'fixtureId': 101,
                'gameweekId': 1,
                'opponentTeamId': 20,
                'wasHome': True,
                'kickoffTime': '2026-08-11T11:30:00.000Z',
                'totalPoints': 5,
                'minutes': 90,
                'price': 12.5,
                'selected': 1000000
            },
            {
                'playerId': 1,
                'fixtureId': 102,
                'gameweekId': 2,
                'opponentTeamId': 20,
                'wasHome': True,
                'kickoffTime': '2026-08-12T11:30:00.000Z',
                'totalPoints': 7,
                'minutes': 80,
                'price': 12.6,
                'selected': 1100000
            },
            {
                'playerId': 1,
                'fixtureId': 103,
                'gameweekId': 3,
                'opponentTeamId': 20,
                'wasHome': True,
                'kickoffTime': '2026-08-13T11:30:00.000Z',
                'totalPoints': 2,
                'minutes': 70,
                'price': 12.6,
                'selected': 1200000
            }
        ]
    }


def history_feature_dataset() -> dict[str, object]:
    dataset = snapshot_dataset(checked_gameweek=3, target_gameweek=4, total_points=14, minutes=240)
    dataset['events'] = [
        {
            **event,
            'finished': True,
            'dataChecked': True,
            'isCurrent': event['id'] == 3,
            'isNext': False
        }
        for event in dataset['events']
    ]
    dataset['fixtures'] = [
        {
            'id': fixture_id,
            'code': fixture_id,
            'eventId': gameweek_id,
            'kickoffTime': f'2026-08-{10 + gameweek_id:02d}T11:30:00.000Z',
            'teamHId': 1,
            'teamAId': 20,
            'teamHScore': 1,
            'teamAScore': 0,
            'teamHDifficulty': 2,
            'teamADifficulty': 4,
            'started': True,
            'finished': True
        }
        for fixture_id, gameweek_id in ((101, 1), (102, 2), (103, 3))
    ]
    dataset['manifest'] = {
        **dataset['manifest'],
        'recordCounts': {
            'players': 1,
            'teams': 2,
            'events': len(dataset['events']),
            'fixtures': len(dataset['fixtures'])
        }
    }
    return dataset


def snapshot_dataset(
    checked_gameweek: int,
    target_gameweek: int,
    *,
    total_points: int,
    minutes: int
) -> dict[str, object]:
    events = [
        {
            'id': gameweek_id,
            'name': f'Gameweek {gameweek_id}',
            'deadlineTime': f'2026-08-{10 + gameweek_id:02d}T17:30:00.000Z',
            'averageEntryScore': 50 if gameweek_id <= checked_gameweek else None,
            'highestScore': 100 if gameweek_id <= checked_gameweek else None,
            'finished': gameweek_id <= checked_gameweek,
            'dataChecked': gameweek_id <= checked_gameweek,
            'isCurrent': gameweek_id == checked_gameweek,
            'isNext': gameweek_id == target_gameweek
        }
        for gameweek_id in range(1, 6)
    ]

    return {
        'manifest': {
            'schemaVersion': 1,
            'season': '2026-27',
            'generatedAt': f'2026-08-{10 + checked_gameweek:02d}T18:00:00.000Z',
            'currentEventId': checked_gameweek,
            'sources': [
                {
                    'name': 'bootstrap-static',
                    'url': 'https://fantasy.premierleague.com/api/bootstrap-static/',
                    'fetchedAt': f'2026-08-{10 + checked_gameweek:02d}T17:55:00.000Z',
                    'httpDate': None,
                    'etag': f'etag-{checked_gameweek}',
                    'lastModified': None
                },
                {
                    'name': 'fixtures',
                    'url': 'https://fantasy.premierleague.com/api/fixtures/',
                    'fetchedAt': f'2026-08-{10 + checked_gameweek:02d}T17:56:00.000Z',
                    'httpDate': None,
                    'etag': None,
                    'lastModified': None
                }
            ],
            'recordCounts': {
                'players': 1,
                'teams': 2,
                'events': len(events),
                'fixtures': 1
            }
        },
        'players': [
            {
                'id': 1,
                'code': 100,
                'firstName': 'Alpha',
                'secondName': 'Forward',
                'webName': 'Alpha',
                'displayName': 'Alpha Forward',
                'teamId': 1,
                'position': 'FWD',
                'nowCost': 12.5,
                'status': 'a',
                'chanceOfPlayingNextRound': 100,
                'chanceOfPlayingThisRound': 100,
                'form': 6.2,
                'selectedByPercent': 42.5,
                'pointsPerGame': 5.0,
                'valueSeason': 12.8,
                'totalPoints': total_points,
                'minutes': minutes,
                'starts': checked_gameweek,
                'expectedGoals': 1.0,
                'expectedAssists': 0.4,
                'expectedGoalInvolvements': 1.4,
                'expectedGoalsConceded': 0.0
            }
        ],
        'teams': [
            {
                'id': 1,
                'code': 1,
                'name': 'Arsenal',
                'shortName': 'ARS',
                'strength': 5,
                'strengthOverallHome': 1350,
                'strengthOverallAway': 1320
            },
            {
                'id': 20,
                'code': 20,
                'name': 'Wolves',
                'shortName': 'WOL',
                'strength': 3,
                'strengthOverallHome': 1040,
                'strengthOverallAway': 1010
            }
        ],
        'events': events,
        'fixtures': [
            {
                'id': 100 + target_gameweek,
                'code': 100 + target_gameweek,
                'eventId': target_gameweek,
                'kickoffTime': f'2026-08-{11 + target_gameweek:02d}T11:30:00.000Z',
                'teamHId': 1,
                'teamAId': 20,
                'teamHScore': None,
                'teamAScore': None,
                'teamHDifficulty': 2,
                'teamADifficulty': 4,
                'started': False,
                'finished': False
            }
        ]
    }


if __name__ == '__main__':
    unittest.main()
