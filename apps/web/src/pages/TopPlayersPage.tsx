import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PlanningState } from '../state/usePlanning';
import { formatXp, formatPrice, normalizePlayerSearch, positionNames, predictionAvailability } from '../lib/format';
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
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Player projections</h1>
        <p className="page-lede">Projected points for every player across all of their fixtures in the gameweek.</p>
      </div>
      <GameweekStatus planning={planning} />
      {planning.loading ? <LoadingSpinner text="Loading player projections…" /> : players.length ? (
        <section className="min-w-0 space-y-5" aria-label="Player rankings">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_10rem_12rem]">
            <label className="field-label col-span-2 sm:col-span-1">Search players
              <input type="search" className="input-field mt-1 font-normal" value={query} maxLength={100}
                placeholder="Name or club" onChange={event => setFilter('q', event.target.value)} />
            </label>
            <div className="min-w-0">
              <label htmlFor="projection-club" className="field-label">Club</label>
              <select id="projection-club" className="input-field mt-1" value={club} onChange={event => setFilter('club', event.target.value)}>
                <option value="">All clubs</option>
                {clubs.map(name => <option key={name}>{name}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="projection-sort" className="field-label">Sort by</label>
              <select id="projection-sort" className="input-field mt-1" value={sort} onChange={event => setFilter('sort', event.target.value)}>
                <option value="points">Most points</option>
                <option value="price-asc">Lowest price</option>
                <option value="price-desc">Highest price</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Filter by position">
            <button type="button" className="filter-chip" aria-label="All positions" aria-pressed={!position} onClick={() => setFilter('pos', '')}>
              <span className="sm:hidden">All</span><span className="hidden sm:inline">All positions</span>
            </button>
            {(Object.keys(positionNames) as Pos[]).map(pos => (
              <button type="button" key={pos} className="filter-chip" aria-pressed={position === pos} onClick={() => setFilter('pos', pos)}>
                <span className="sm:hidden" aria-hidden="true">{pos}</span><span className="sr-only sm:not-sr-only">{positionNames[pos]}</span>
              </button>
            ))}
          </div>

          {results.length ? (
            <>
              <table className="data-table table-fixed">
                <caption className="pb-2 text-left text-[13px] tabular-nums text-ink-faint" role="status">
                  Showing {start + 1}–{Math.min(start + PAGE_SIZE, results.length)} of {results.length} players
                </caption>
                <thead>
                  <tr>
                    <th className="w-8 !px-0 text-right sm:w-10" scope="col"><span className="sr-only">Rank</span></th>
                    <th scope="col">Player</th>
                    <th className="hidden w-32 sm:table-cell" scope="col">Fixture</th>
                    <th className="w-[4.5rem] text-right sm:w-24" scope="col">Price</th>
                    <th className="w-14 text-right sm:w-20" scope="col"><abbr title="Projected points" className="no-underline">xP</abbr></th>
                  </tr>
                </thead>
                <tbody>
                  {results.slice(start, start + PAGE_SIZE).map((player, index) => (
                    <PlayerTableRow key={player.playerId} player={player} rank={start + index + 1} />
                  ))}
                </tbody>
              </table>
              {pageCount > 1 && <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Player results pages">
                <button type="button" className="btn-secondary" disabled={page === 1} onClick={() => setFilter('page', String(page - 1))}>Previous</button>
                <span className="text-sm tabular-nums text-ink-soft">Page {page} of {pageCount}</span>
                <button type="button" className="btn-secondary" disabled={page === pageCount} onClick={() => setFilter('page', String(page + 1))}>Next</button>
              </nav>}
            </>
          ) : <p role="status" className="panel-sunk text-sm">No players match these filters.</p>}
        </section>
      ) : <div className="py-6">
        <h2 className="section-title">Projections are unavailable</h2>
        <p className="mt-2 text-sm text-ink-soft">You can still browse and add players in the <Link className="text-link" to="/squad">squad builder</Link>.</p>
      </div>}
    </div>
  );
}

function PlayerTableRow({ player, rank }: { player: PlayerPrediction; rank: number }) {
  const status = predictionAvailability(player);
  const flagged = status === 'Doubtful' || status === 'Unavailable' || status === 'No fixture';
  const fixture = player.fixtureCount === 0 ? '—' : player.opponents?.join(', ') ?? '';
  return (
    <tr>
      <td className="figure !px-0 text-right text-[13px] text-ink-faint">{rank}</td>
      <td className="break-words">
        <Link className="font-semibold text-ink hover:text-pitch-turf" to={`/player/${player.playerId}`}>{player.playerName}</Link>
        <p className="text-[13px] text-ink-soft">
          {player.teamShortName} · {player.position}
          {fixture && <span className="sm:hidden"> · {fixture}</span>}
          {status !== 'Available' && <>{' · '}<span className={flagged ? 'font-semibold text-clay' : undefined}>{status}</span></>}
        </p>
      </td>
      <td className="hidden text-ink-soft sm:table-cell">{fixture}</td>
      <td className="text-right tabular-nums text-ink-soft">{formatPrice(player.price)}</td>
      <td className="figure text-right text-base text-ink">{formatXp(player.predictedPoints)}</td>
    </tr>
  );
}
