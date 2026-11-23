import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { EnrichedPlayer } from '../lib/types';
import { apiClient, apiErrorMessage } from '../lib/api';
import { formatPrice, formatPoints, predictionAvailability } from '../lib/format';
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
    return <div className="card">
      <h1 className="page-title">Player not found</h1>
      <p className="mt-2 text-slate-600">Search the current FPL player list or return to the rankings.</p>
      <Link className="text-link mt-4 inline-block" to="/top-players">Browse player projections</Link>
    </div>;
  }
  if (loaded?.id === playerId && loaded.error) return <ErrorMessage message={loaded.error} action={{ label: 'Retry player', onClick: () => setRetry(value => value + 1) }} />;
  if (!player) return <LoadingSpinner text="Loading player…" />;

  const selected = [...squadState.squad.startingXI, ...squadState.squad.bench].some(slot => slot.id === playerId);
  const projection = planning.data?.players.find(row => row.playerId === playerId);
  const week = planning.data?.gameweek;
  const draftIneligible = squadState.squad.mode !== 'existing' && player.status === 'u';
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-4 text-sm">
        <Link to="/top-players" className="text-link">Player projections</Link>
        <Link to="/squad" className="text-link">Your squad</Link>
      </div>
      <section className="card flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fpl-green-dark">{player.teamShort} · {player.pos}</p>
          <h1 className="page-title mt-1 break-words">{player.name}</h1>
          <p className="mt-2 text-slate-600">{formatPrice(player.price)} · {statusLabels[player.status] ?? 'Availability unknown'}</p>
          <button type="button" className="btn-primary mt-4" disabled={selected || draftIneligible} onClick={() => squadState.addPlayer(player)}>
            {selected ? 'In your squad' : draftIneligible ? 'Unavailable for a new draft' : 'Add to squad'}
          </button>
        </div>
        <div className="rounded-lg bg-slate-100 p-4">
          <h2 className="text-sm font-semibold text-slate-700">{week ? `Gameweek ${week.id} projection` : 'Gameweek projection'}</h2>
          {projection ? <>
            <p className="mt-1 text-3xl font-bold tabular-nums text-fpl-dark">{formatPoints(projection.predictedPoints)} <span className="text-sm">pts</span></p>
            <p className="mt-1 text-sm text-slate-600">{predictionAvailability(projection)}</p>
          </> : <p className="mt-1 text-sm text-slate-600">{planning.loading ? 'Loading projection…' : 'Projection unavailable'}</p>}
        </div>
      </section>
      <GameweekStatus planning={planning} />
      {squadState.error && <ErrorMessage message={squadState.error} onDismiss={squadState.clearError} />}
      <section>
        <h2 className="mb-3 text-lg font-semibold">FPL season statistics</h2>
        <PlayerStats player={player} />
      </section>
    </div>
  );
}
