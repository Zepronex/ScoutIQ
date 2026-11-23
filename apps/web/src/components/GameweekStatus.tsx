import { RefreshCw } from 'lucide-react';
import { PlanningState } from '../state/usePlanning';
import { formatCountdown, formatDateTime, formatShortDateTime } from '../lib/format';

/** One line of context shown on every planning page: which gameweek, when it locks, how fresh the data is. */
export default function GameweekStatus({ planning }: { planning: PlanningState }) {
  const gameweek = planning.data?.gameweek;
  const sample = planning.data?.source === 'sample';
  const ready = gameweek?.runId != null && Boolean(planning.data?.players.length);
  const updated = gameweek ? new Date(gameweek.sourceUpdatedAt) : null;
  const stale = updated && Date.now() - updated.getTime() > 48 * 60 * 60 * 1000;
  const countdown = gameweek ? formatCountdown(gameweek.deadline) : null;

  return (
    <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-y border-line py-3" aria-label="Gameweek status">
      <div className="min-w-0" role="status">
        <p className="font-semibold text-ink">
          {gameweek ? `Gameweek ${gameweek.id}${gameweek.season ? ` · ${gameweek.season}` : ''}`
            : planning.loading ? 'Checking the FPL schedule…' : planning.error ? 'FPL schedule unavailable' : 'No open FPL gameweek'}
        </p>
        <p className="mt-0.5 text-sm text-ink-soft">
          {planning.error || (gameweek
            ? <>Deadline {formatDateTime(gameweek.deadline)} (your time){countdown && <> · <span className="font-semibold text-ink">{countdown} left</span></>}</>
            : 'Squad editing is available while projections are offline.')}
        </p>
      </div>
      <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
        <div className="text-sm text-ink-soft sm:text-right">
          <p className={sample || stale ? 'font-semibold text-amber' : 'font-semibold text-ink'}>
            {sample ? 'Sample data' : stale ? 'FPL snapshot over 48 hours old' : ready ? 'Official FPL snapshot' : 'Projections unavailable'}
          </p>
          {updated && <p className="tabular-nums">Captured {formatShortDateTime(updated)}</p>}
          {!ready && gameweek && !planning.loading && <p>Waiting for gameweek projections</p>}
          {ready && !!planning.data?.missingPlayerCount && <p className="font-medium text-amber">
            {planning.data.missingPlayerCount === 1 ? '1 player lacks full projections' : `${planning.data.missingPlayerCount} players lack full projections`}
          </p>}
        </div>
        <button type="button" className="icon-button" onClick={planning.reload} disabled={planning.loading} aria-label="Refresh gameweek data">
          <RefreshCw className={`h-4 w-4 ${planning.loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
