"""Store one season's training rows as the sums the regression needs.

    python -m pipelines.expected_points.build_prior --season 2025-26 \
        --input data/features/player_gameweek_training_rows.jsonl

The output is committed so a new season can start from last season's fit
without shipping the raw rows.
"""
from __future__ import annotations

import argparse
from typing import Sequence

from pipelines.databricks.cli import resolve_repo_path
from pipelines.expected_points.features import validate_training_feature_row
from pipelines.expected_points.io import read_jsonl, write_json
from pipelines.expected_points.regression import SeasonPrior, SufficientStatistics


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Summarise a finished season as a model prior.')
    parser.add_argument('--input', default='data/features/player_gameweek_training_rows.jsonl')
    parser.add_argument('--season', required=True, help='Season label, for example 2025-26.')
    parser.add_argument('--output', default=None)
    args = parser.parse_args(argv)

    rows = read_jsonl(resolve_repo_path(args.input))
    if not rows:
        raise ValueError('No training rows to summarise')
    for row in rows:
        validate_training_feature_row(row)

    output = args.output or f"pipelines/expected_points/priors/season_{args.season.replace('-', '_')}.json"
    prior = SeasonPrior(args.season, SufficientStatistics.from_rows(rows))
    write_json(resolve_repo_path(output), prior.to_dict())
    print(f'Wrote {args.season} prior from {len(rows)} rows to {output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
