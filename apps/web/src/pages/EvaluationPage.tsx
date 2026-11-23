import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import ErrorMessage from '../components/ErrorMessage';
import LoadingSpinner from '../components/LoadingSpinner';
import { apiClient } from '../lib/api';
import { formatCount, formatShortDateTime, positionNames } from '../lib/format';
import { EvaluationDataHealth, EvaluationLatest, EvaluationMetricComparison, EvaluationRuns } from '../lib/types';

type State = {
  latest: EvaluationLatest | null;
  health: EvaluationDataHealth | null;
  runs: EvaluationRuns | null;
  loading: boolean;
  error: string | null;
};

const metric = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

const inputs = [
  ['Recent form', 'Average points over the player’s last three fixtures.'],
  ['Season form', 'Average points over every fixture so far this season.'],
  ['Minutes', 'Share of available minutes played, recently and across the season.'],
  ['Price', 'What the game charges for the player, which tracks expected output.'],
  ['Fixture', 'FPL’s difficulty rating for the opponent, and home or away.'],
  ['Availability', 'The published chance of playing. Injured and suspended players project to zero.']
];

const blindSpots = [
  'Team news after the data was captured, including late injuries and rotation.',
  'Penalty and set-piece duty, tactical changes and new signings with no minutes yet.',
  'Anything beyond the next gameweek. Transfers are judged on one gameweek only.',
  'Chips, automatic substitutions and bonus-point patterns.'
];

export default function EvaluationPage() {
  const [state, setState] = useState<State>({ latest: null, health: null, runs: null, loading: true, error: null });

  const load = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const [latest, health, runs] = await Promise.all([
        apiClient.getEvaluationLatest(),
        apiClient.getEvaluationDataHealth(),
        apiClient.getEvaluationRuns(5)
      ]);
      if (!latest.success || !latest.data || !health.success || !health.data || !runs.success || !runs.data) {
        throw new Error('Incomplete evaluation data');
      }
      setState({ latest: latest.data, health: health.data, runs: runs.data, loading: false, error: null });
    } catch {
      setState(current => ({ ...current, loading: false, error: 'Could not load the model results. Try again shortly.' }));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (state.loading) return <LoadingSpinner text="Loading model results…" />;
  if (state.error) return <ErrorMessage title="Model results unavailable" message={state.error} action={{ label: 'Retry', onClick: load }} />;

  const run = state.latest?.latestRun ?? null;
  const coverage = state.health?.coverage ?? null;
  const prediction = state.latest?.latestPredictionRun ?? null;
  const weeks = run?.evaluatedGameweeks ?? [];
  const range = weeks.length ? (weeks.length > 1 ? `Gameweeks ${weeks[0]} to ${weeks[weeks.length - 1]}` : `Gameweek ${weeks[0]}`) : null;

  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">How good are the projections?</h1>
          <p className="page-lede">
            Every projection comes from a small statistical model. It is tested on gameweeks it had not seen
            and compared with a simple benchmark: a player’s average over their last three fixtures.
          </p>
        </div>
        <button type="button" onClick={load} className="btn-secondary">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </button>
      </header>

      {run ? (
        <section aria-labelledby="backtest">
          <div className="rule-heading">
            <h2 id="backtest" className="section-title">Backtest{range ? ` · ${range}` : ''}</h2>
            <span className="shrink-0 text-[13px] tabular-nums text-ink-soft">{formatCount(run.backtestRows ?? run.predictionCount)} predictions</span>
          </div>
          <p className="mt-4 max-w-3xl text-base leading-relaxed">{verdict(run.mae, run.rmse)}</p>
          <div className="mt-6 grid gap-x-12 gap-y-8 md:grid-cols-2">
            <Comparison title="Average miss" abbreviation="MAE" comparison={run.mae}
              note="How far a projection was from the real score on average, in points." />
            <Comparison title="Penalty for big misses" abbreviation="RMSE" comparison={run.rmse}
              note="Like the average miss, but large errors count for more." />
          </div>
          <p className="mt-5 text-[13px] text-ink-faint">Lower is better on both measures.</p>

          {run.byPosition.length > 0 && (
            <div className="mt-10 overflow-x-auto">
              <table className="data-table min-w-[30rem]">
                <caption className="pb-3 text-left text-sm font-semibold text-ink">By position</caption>
                <thead>
                  <tr>
                    <th scope="col">Position</th>
                    <th scope="col" className="text-right">Predictions</th>
                    <th scope="col" className="text-right">Average miss</th>
                    <th scope="col" className="text-right">Benchmark</th>
                    <th scope="col" className="text-right">Big-miss score</th>
                    <th scope="col" className="text-right">Benchmark</th>
                  </tr>
                </thead>
                <tbody>
                  {run.byPosition.map(row => (
                    <tr key={row.position}>
                      <th scope="row" className="border-b border-line px-2 py-2.5 text-left font-semibold sm:px-3">{positionNames[row.position]}</th>
                      <td className="text-right tabular-nums text-ink-soft">{formatCount(row.count)}</td>
                      <Cell comparison={row.mae} />
                      <td className="text-right tabular-nums text-ink-soft">{formatMetric(row.mae.baselineValue)}</td>
                      <Cell comparison={row.rmse} />
                      <td className="text-right tabular-nums text-ink-soft">{formatMetric(row.rmse.baselineValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <ErrorMessage type="info" title="No backtest yet"
          message="The model is tested once three gameweeks of the season are complete. Projections before then come from last season’s fit." />
      )}

      <div className="grid gap-x-14 gap-y-12 lg:grid-cols-2">
        <section aria-labelledby="model-inputs">
          <div className="rule-heading"><h2 id="model-inputs" className="section-title">What goes into a projection</h2></div>
          <dl>
            {inputs.map(([term, description]) => (
              <div key={term} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 border-b border-line py-3 text-sm">
                <dt className="font-semibold">{term}</dt>
                <dd className="leading-relaxed text-ink-soft">{description}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            The weights are fitted to this season’s results together with a summary of last season, so early gameweeks
            are not guesswork. Lineups, captaincy and transfers are then chosen by an optimizer that enforces the FPL squad rules.
          </p>
        </section>

        <section aria-labelledby="model-limits">
          <div className="rule-heading"><h2 id="model-limits" className="section-title">What it cannot see</h2></div>
          <ul>
            {blindSpots.map(item => <li key={item} className="border-b border-line py-3 text-sm leading-relaxed text-ink-soft">{item}</li>)}
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            Treat a projection as a starting point. A typical miss of more than a point per player means close calls are close.
          </p>
        </section>
      </div>

      <section aria-labelledby="model-data">
        <div className="rule-heading">
          <h2 id="model-data" className="section-title">Data behind the current projections</h2>
          {prediction?.sourceGeneratedAt && <span className="shrink-0 text-[13px] text-ink-soft">Captured {formatShortDateTime(prediction.sourceGeneratedAt)}</span>}
        </div>
        {coverage && (
          <dl className="grid grid-cols-2 border-b border-line sm:grid-cols-3 lg:grid-cols-6">
            {([
              ['Players', coverage.players], ['Clubs', coverage.teams], ['Fixtures', coverage.fixtures],
              ['Projections', coverage.latestPredictionRows], ['Backtests run', coverage.evaluationRuns],
              ['Gameweeks tested', weeks.length]
            ] as Array<[string, number]>).map(([label, value]) => (
              <div key={label} className="py-4 pr-4">
                <dt className="eyebrow">{label}</dt>
                <dd className="figure mt-2 text-3xl leading-none">{formatCount(value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {state.runs && state.runs.runs.length > 1 && (
          <div className="mt-8 overflow-x-auto">
            <table className="data-table min-w-[26rem]">
              <caption className="pb-3 text-left text-sm font-semibold text-ink">Recent backtests</caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col" className="text-right">Predictions</th>
                  <th scope="col" className="text-right">Average miss</th>
                  <th scope="col" className="text-right">Big-miss score</th>
                </tr>
              </thead>
              <tbody>
                {state.runs.runs.map(item => (
                  <tr key={item.id}>
                    <td className="tabular-nums">{formatShortDateTime(item.createdAt)}</td>
                    <td className="text-right tabular-nums text-ink-soft">{formatCount(item.backtestRows ?? item.predictionCount)}</td>
                    <td className="text-right tabular-nums">{formatMetric(item.mae.modelValue)}</td>
                    <td className="text-right tabular-nums">{formatMetric(item.rmse.modelValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-5 text-[13px] leading-relaxed text-ink-faint">
          {run && <>Model <code className="rounded bg-paper-sunk px-1">{run.modelVersion}</code>. </>}
          Source: the official Fantasy Premier League data feed. <Link className="text-link" to="/top-players">See this week’s projections</Link>.
        </p>
      </section>
    </div>
  );
}

function verdict(mae: EvaluationMetricComparison, rmse: EvaluationMetricComparison): string {
  if (mae.modelBeatsBaseline === null || rmse.modelBeatsBaseline === null) {
    return 'The benchmark comparison is incomplete for this run.';
  }
  if (mae.modelBeatsBaseline && rmse.modelBeatsBaseline) {
    return 'The model was closer to the real scores than the benchmark on both measures. The margin on the average miss is small, so it is an edge, not a guarantee.';
  }
  if (!mae.modelBeatsBaseline && !rmse.modelBeatsBaseline) {
    return 'The benchmark was closer to the real scores than the model on both measures in this run. Treat the projections with extra caution.';
  }
  return rmse.modelBeatsBaseline
    ? 'A mixed result. The model made fewer large errors than the benchmark, but its average miss was slightly higher.'
    : 'A mixed result. The model’s average miss was lower than the benchmark’s, but it made more large errors.';
}

function Comparison({ title, abbreviation, comparison, note }: {
  title: string; abbreviation: string; comparison: EvaluationMetricComparison; note: string;
}) {
  const { modelValue, baselineValue } = comparison;
  const scale = Math.max(modelValue ?? 0, baselineValue ?? 0) || 1;
  const change = modelValue !== null && baselineValue ? ((modelValue - baselineValue) / baselineValue) * 100 : null;
  return (
    <div>
      <h3 className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{title} <abbr className="text-[13px] font-normal text-ink-faint no-underline" title={abbreviation === 'MAE' ? 'Mean absolute error' : 'Root mean squared error'}>{abbreviation}</abbr></span>
        {change !== null && (
          <span className={`text-[13px] font-semibold tabular-nums ${change < 0 ? 'text-pitch-turf' : 'text-clay'}`}>
            {percent.format(Math.abs(change))}% {change < 0 ? 'lower' : 'higher'} than benchmark
          </span>
        )}
      </h3>
      <div className="mt-3 space-y-2">
        <Bar label="Model" value={modelValue} scale={scale} strong />
        <Bar label="Benchmark" value={baselineValue} scale={scale} />
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">{note}</p>
    </div>
  );
}

function Bar({ label, value, scale, strong }: { label: string; value: number | null; scale: number; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_3.25rem] items-center gap-3 text-sm">
      <span className={strong ? 'font-semibold' : 'text-ink-soft'}>{label}</span>
      <span className="h-5 rounded-sm bg-paper-sunk">
        <span className={`block h-full rounded-sm ${strong ? 'bg-pitch-turf' : 'bg-line-strong'}`}
          style={{ width: `${value === null ? 0 : Math.max(2, (value / scale) * 100)}%` }} />
      </span>
      <span className="figure text-right text-base">{formatMetric(value)}</span>
    </div>
  );
}

function Cell({ comparison }: { comparison: EvaluationMetricComparison }) {
  return (
    <td className={`text-right font-semibold tabular-nums ${comparison.modelBeatsBaseline === false ? 'text-clay' : 'text-ink'}`}>
      {formatMetric(comparison.modelValue)}
    </td>
  );
}

function formatMetric(value: number | null): string {
  return value === null ? '—' : metric.format(value);
}
