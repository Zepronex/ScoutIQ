import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PlanningState } from '../state/usePlanning';
import { formatPoints, formatPrice, normalizePlayerSearch, positionNames, predictionAvailability } from '../lib/format';
import { PlayerPrediction, Pos } from '../lib/types';
import GameweekStatus from '../components/GameweekStatus';
import LoadingSpinner from '../components/LoadingSpinner';

const PAGE_SIZE = 20;

export default function TopPlayersPage({ planning }: { planning: PlanningState }) {
  const [urlParams, setUrlParams] = useSearchParams();
  const [params, setParams] = useState(urlParams);
  const latestParams = useRef(urlParams);
  useLayoutEffect(() => {
    latestParams.current = urlParams;
    setParams(urlParams);
  }, [urlParams]);
  const query = params.get('q') ?? '';
  const position = params.get('pos') ?? '';
  const club = params.get('club') ?? '';
  const sort = params.get('sort') ?? 'points';
  const players = planning.data?.players ?? [];
  const clubs = [...new Set(players.map(player => player.teamShortName).filter(Boolean))].sort();
  const terms = normalizePlayerSearch(query).split(' ');
  const results = players.filter(player => {
    const label = normalizePlayerSearch(`${player.playerName} ${player.teamShortName ?? ''}`);
    return (!position || player.position === position) && (!club || player.teamShortName === club) &&
      terms.every(term => label.includes(term));
  }).sort((a, b) => {
    const diff = sort === 'price-asc' ? a.price - b.price
      : sort === 'price-desc' ? b.price - a.price : sort === 'name' ? 0 : b.predictedPoints - a.predictedPoints;
    return diff || a.playerName.localeCompare(b.playerName) || a.playerId - b.playerId;
  });
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const requestedPage = Number(params.get('page') ?? 1);
  const page = Number.isInteger(requestedPage) ? Math.min(pageCount, Math.max(1, requestedPage)) : 1;
  const start = (page - 1) * PAGE_SIZE;
  const setFilter = (key: string, value: string) => {
    const updated = new URLSearchParams(latestParams.current);
    if (value) updated.set(key, value);
    else updated.delete(key);
    if (key !== 'page') updated.delete('page');
    latestParams.current = updated;
    setParams(updated);
    setUrlParams(updated, { replace: true });
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Player projections</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Compare model estimates across all scheduled fixtures in the gameweek.</p>
      </div>
      <GameweekStatus planning={planning} />
      {planning.loading ? <LoadingSpinner text="Loading player projections…" /> : players.length ? (
        <section className="card min-w-0 space-y-4" aria-label="Player rankings">
          <div className="flex flex-wrap gap-2" aria-label="Filter by position">
            <button className="filter-chip" aria-label="All positions" aria-pressed={!position} onClick={() => setFilter('pos', '')}>
              <span className="sm:hidden">All</span><span className="hidden sm:inline">All positions</span>
            </button>
            {(Object.keys(positionNames) as Pos[]).map(pos => (
              <button key={pos} className="filter-chip" aria-pressed={position === pos} onClick={() => setFilter('pos', pos)}>
                <span className="sm:hidden" aria-hidden="true">{pos}</span><span className="sr-only sm:not-sr-only">{positionNames[pos]}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_10rem_12rem]">
            <label className="col-span-2 text-sm font-semibold sm:col-span-1">Search players
              <input type="search" className="input-field mt-1 font-normal" value={query} maxLength={100}
                placeholder="Name or club" onChange={event => setFilter('q', event.target.value)} />
            </label>
            <div className="min-w-0 text-sm font-semibold">
              <label htmlFor="projection-club">Club</label>
              <select id="projection-club" className="input-field mt-1 font-normal" value={club} onChange={event => setFilter('club', event.target.value)}>
                <option value="">All clubs</option>
                {clubs.map(name => <option key={name}>{name}</option>)}
              </select>
            </div>
            <div className="min-w-0 text-sm font-semibold">
              <label htmlFor="projection-sort">Sort by</label>
              <select id="projection-sort" className="input-field mt-1 font-normal" value={sort} onChange={event => setFilter('sort', event.target.value)}>
                <option value="points">Most points</option>
                <option value="price-asc">Lowest price</option>
                <option value="price-desc">Highest price</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>

          {results.length ? (
            <>
              <p role="status" className="text-sm tabular-nums text-slate-600">Showing {start + 1}–{Math.min(start + PAGE_SIZE, results.length)} of {results.length} players</p>
              <table className="w-full table-fixed text-left text-sm">
                <thead className="border-b border-slate-300 bg-slate-100 text-xs text-slate-700">
                  <tr>
                    <th className="w-[56%] px-2 py-3 sm:px-3" scope="col">Player</th>
                    <th className="px-2 py-3 text-right" scope="col">Price</th>
                    <th className="px-2 py-3 text-right" scope="col"><abbr title="Expected points" className="no-underline">xP</abbr></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {results.slice(start, start + PAGE_SIZE).map(player => <PlayerTableRow key={player.playerId} player={player} />)}
                </tbody>
              </table>
              {pageCount > 1 && <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Player results pages">
                <button className="btn-secondary" disabled={page === 1} onClick={() => setFilter('page', String(page - 1))}>Previous</button>
                <span className="text-sm tabular-nums text-slate-700">Page {page} of {pageCount}</span>
                <button className="btn-secondary" disabled={page === pageCount} onClick={() => setFilter('page', String(page + 1))}>Next</button>
              </nav>}
            </>
          ) : <p role="status" className="rounded-lg bg-slate-100 p-4 text-sm">No players match these filters.</p>}
        </section>
      ) : <div className="card">
        <h2 className="text-lg font-semibold">Projections are unavailable</h2>
        <p className="mt-2 text-sm text-slate-600">You can still browse and add players in the <Link className="text-link" to="/squad">squad builder</Link>.</p>
      </div>}
    </div>
  );
}

function PlayerTableRow({ player }: { player: PlayerPrediction }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="break-words px-2 py-2.5 sm:px-3">
        <Link className="text-link font-semibold" to={`/player/${player.playerId}`}>{player.playerName}</Link>
        <p className="mt-0.5 text-xs text-slate-600">
          {player.teamShortName} · {player.position} · {predictionAvailability(player)}
        </p>
      </td>
      <td className="px-2 text-right tabular-nums">{formatPrice(player.price)}</td>
      <td className="px-2 text-right font-semibold tabular-nums text-fpl-green-dark">{formatPoints(player.predictedPoints)}</td>
    </tr>
  );
}
