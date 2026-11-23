import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { EnrichedPlayer } from '../lib/types';
import { apiClient, apiErrorMessage } from '../lib/api';
import { formatOnePlace, formatPrice, formatXp, positionNames, predictionAvailability } from '../lib/format';
import PlayerStats from '../components/PlayerStats';
import ErrorMessage from '../components/ErrorMessage';
import LoadingSpinner from '../components/LoadingSpinner';
import GameweekStatus from '../components/GameweekStatus';
import { SquadState } from '../state/useSquad';
import { PlanningState } from '../state/usePlanning';

const statusLabels: Record<string, string> = { a: 'Available', d: 'Doubtful', i: 'Injured', s: 'Suspended', n: 'Unavailable', u: 'Unavailable' };

export default function PlayerDetailPage({ squadState, planning }: { squadState: SquadState; planning: PlanningState }) {
  const { id } = useParams();
  const playerId = Number(id);
  const validId = typeof id === 'string' && /^\d+$/.test(id) && Number.isSafeInteger(playerId) && playerId > 0;
  const [loaded, setLoaded] = useState<{ id: number; player?: EnrichedPlayer; error?: string; missing?: boolean }>();
  const [retry, setRetry] = useState(0);
  const updated = planning.data?.gameweek?.sourceUpdatedAt;

  useEffect(() => {
    if (!validId) return;
    const controller = new AbortController();
    setLoaded(undefined);
    void apiClient.getPlayerById(playerId, controller.signal).then(response => {
      if (!controller.signal.aborted) setLoaded({ id: playerId, player: response.data, missing: !response.data });
    }).catch(error => {
      if (controller.signal.aborted) return;
      const missing = axios.isAxiosError(error) && error.response?.status === 404;
      setLoaded({ id: playerId, missing, error: apiErrorMessage(error, 'Could not load this player.') });
    });
    return () => controller.abort();
  }, [playerId, validId, retry, updated]);

  const player = loaded?.id === playerId ? loaded.player : undefined;
  if (!validId || (loaded?.id === playerId && loaded.missing)) {
    return <div className="py-10">
      <p className="eyebrow">Error 404</p>
      <h1 className="page-title mt-3">Player not found</h1>
      <p className="page-lede">Search the current FPL player list or return to the rankings.</p>
      <Link className="btn-dark mt-6" to="/top-players">Browse player projections</Link>
    </div>;
  }
  if (loaded?.id === playerId && loaded.error) return <ErrorMessage message={loaded.error} action={{ label: 'Retry player', onClick: () => setRetry(value => value + 1) }} />;
  if (!player) return <LoadingSpinner text="Loading player…" />;

  const selected = [...squadState.squad.startingXI, ...squadState.squad.bench].some(slot => slot.id === playerId);
  const projection = planning.data?.players.find(row => row.playerId === playerId);
  const week = planning.data?.gameweek;
  const draftIneligible = squadState.squad.mode !== 'existing' && player.status === 'u';
  const ranked = projection && planning.data
    ? planning.data.players.filter(row => row.position === projection.position && row.predictedPoints > projection.predictedPoints).length + 1
    : null;
  const flagged = player.status !== 'a';
  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <Link to="/top-players" className="text-link">Player projections</Link>
        <Link to="/squad" className="text-link">Your squad</Link>
      </nav>
      <section className="grid gap-8 border-b border-ink pb-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0">
          <p className="eyebrow">{player.teamShort} · {positionNames[player.pos].replace(/s$/, '')}</p>
          <h1 className="page-title mt-3 break-words">{player.name}</h1>
          <p className="mt-3 text-ink-soft">
            {formatPrice(player.price)} · <span className={flagged ? 'font-semibold text-clay' : undefined}>{statusLabels[player.status] ?? 'Availability unknown'}</span>
            {' · '}owned by {formatOnePlace(player.ownership)}%
          </p>
          <button type="button" className="btn-primary mt-5" disabled={selected || draftIneligible} onClick={() => squadState.addPlayer(player)}>
            {selected ? 'In your squad' : draftIneligible ? 'Unavailable for a new draft' : 'Add to squad'}
          </button>
        </div>
        <div className="md:min-w-56 md:border-l md:border-line md:pl-8 md:text-right">
          <h2 className="eyebrow">{week ? `Gameweek ${week.id} projection` : 'Gameweek projection'}</h2>
          {projection ? <>
            <p className="figure mt-2 text-6xl leading-none text-ink">{formatXp(projection.predictedPoints)} <span className="text-lg font-semibold tracking-normal text-ink-soft">pts</span></p>
            <p className="mt-2 text-sm text-ink-soft">
              {projection.opponents?.length ? `v ${projection.opponents.join(', ')} · ` : ''}{predictionAvailability(projection)}
            </p>
            {ranked && projection.fixtureCount !== 0 && <p className="mt-0.5 text-[13px] text-ink-faint">Ranked {ordinal(ranked)} among {positionNames[projection.position].toLowerCase()}</p>}
          </> : <p className="mt-2 text-sm text-ink-soft">{planning.loading ? 'Loading projection…' : 'Projection unavailable'}</p>}
        </div>
      </section>
      {squadState.error && <ErrorMessage title="That change was not made" message={squadState.error} onDismiss={squadState.clearError} />}
      <section aria-labelledby="season-statistics">
        <h2 id="season-statistics" className="section-title">FPL season statistics</h2>
        <PlayerStats player={player} />
      </section>
      <GameweekStatus planning={planning} />
    </div>
  );
}

function ordinal(value: number): string {
  const tens = value % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  return `${value}${suffix}`;
}
