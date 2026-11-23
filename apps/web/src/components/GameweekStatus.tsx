import { CalendarClock, RefreshCw } from 'lucide-react';
import { PlanningState } from '../state/usePlanning';

const localDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function GameweekStatus({ planning }: { planning: PlanningState }) {
  const gameweek = planning.data?.gameweek;
  const sample = planning.data?.source === 'sample';
  const ready = gameweek?.runId != null && Boolean(planning.data?.players.length);
  const updated = gameweek ? new Date(gameweek.sourceUpdatedAt) : null;
  const stale = updated && Date.now() - updated.getTime() > 48 * 60 * 60 * 1000;

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-200 bg-white/70 px-4 py-4 sm:px-6" aria-label="Gameweek status">
      <div className="flex min-w-0 items-start gap-3" role="status">
        <CalendarClock className="mt-1 h-5 w-5 shrink-0 text-fpl-green-dark" aria-hidden="true" />
        <div>
          <p className="font-semibold text-fpl-dark">
            {gameweek ? `Gameweek ${gameweek.id}${gameweek.season ? ` · ${gameweek.season}` : ''}`
              : planning.loading ? 'Checking the FPL schedule…' : planning.error ? 'FPL schedule unavailable' : 'No open FPL gameweek'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {planning.error || (gameweek ? `Deadline ${localDate.format(new Date(gameweek.deadline))} (your time)`
              : 'Squad editing is available while projections are offline.')}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-sm text-slate-600">
          <p className={sample || stale ? 'font-semibold text-amber-800' : 'font-semibold text-slate-800'}>
            {sample ? 'Sample data' : stale ? 'FPL snapshot over 48 hours old' : ready ? 'Official FPL snapshot' : 'Projections unavailable'}
          </p>
          {updated && <p className="tabular-nums">Captured {localDate.format(updated)}</p>}
          {!ready && gameweek && !planning.loading && <p>Waiting for gameweek projections</p>}
          {ready && !!planning.data?.missingPlayerCount && <p className="font-medium text-amber-800">
            {planning.data.missingPlayerCount === 1 ? '1 player lacks full projections' : `${planning.data.missingPlayerCount} players lack full projections`}
          </p>}
        </div>
        <button type="button" className="icon-button" onClick={planning.reload} disabled={planning.loading} aria-label="Refresh gameweek data">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
