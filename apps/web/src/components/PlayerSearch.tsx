import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { EnrichedPlayer, Pos } from '../lib/types';
import { formatXp, formatPrice, normalizePlayerSearch, positionNames } from '../lib/format';

export default function PlayerSearch({ players, selected, existingSquad, projections, onAddPlayer }: {
  players: EnrichedPlayer[];
  selected: Set<number>;
  existingSquad: boolean;
  projections?: ReadonlyMap<number, number>;
  onAddPlayer: (player: EnrichedPlayer) => void;
}) {
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<Pos | ''>('');
  const [limit, setLimit] = useState(8);
  const filtered = useMemo(() => {
    const words = normalizePlayerSearch(search).split(' ');
    return players.filter(player => {
      const label = normalizePlayerSearch(`${player.name} ${player.teamShort}`);
      return (!position || player.pos === position) && words.every(word => label.includes(word));
    }).sort((left, right) => right.ownership - left.ownership || left.name.localeCompare(right.name));
  }, [players, position, search]);

  return (
    <section className="min-w-0" aria-labelledby="add-players">
      <div className="rule-heading">
        <h2 className="section-title" id="add-players">Add players</h2>
      </div>
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-faint" aria-hidden="true" />
        <input aria-label="Search squad players" placeholder="Search by name or club" type="search" className="input-field pl-9"
          value={search} onChange={event => { setSearch(event.target.value); setLimit(8); }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Squad player position">
        <button type="button" className="filter-chip" aria-pressed={!position} onClick={() => { setPosition(''); setLimit(8); }}>All</button>
        {(Object.keys(positionNames) as Pos[]).map(pos => (
          <button key={pos} type="button" className="filter-chip" aria-pressed={position === pos} onClick={() => {
            setPosition(pos);
            setLimit(8);
          }}>{pos}</button>
        ))}
      </div>
      <p className="mt-4 flex items-baseline justify-between text-[13px] text-ink-faint" role="status">
        <span>{filtered.length ? `Showing ${Math.min(filtered.length, limit)} of ${filtered.length} players` : 'No players match your search.'}</span>
        {filtered.length > 0 && projections?.size ? <span className="eyebrow pr-[5.5rem]"><abbr title="Projected points this gameweek" className="no-underline">xP</abbr></span> : null}
      </p>
      <ul className="mt-1 border-t border-line">
        {filtered.slice(0, limit).map(player => {
          const projected = projections?.get(player.id);
          return (
            <li key={player.id} className="flex items-center gap-3 border-b border-line py-2.5">
              <div className="min-w-0 flex-1">
                <Link to={`/player/${player.id}`} className="font-semibold text-ink hover:text-pitch-turf">{player.name}</Link>
                <p className="text-[13px] text-ink-soft">{player.teamShort} · {player.pos} · {formatPrice(player.price)}</p>
              </div>
              {projected !== undefined && <span className="figure text-ink">{formatXp(projected)}</span>}
              <button type="button" className="btn-secondary min-h-9 w-[4.75rem] shrink-0 px-2 py-1 text-[13px]" aria-label={`Add ${player.name}`}
                disabled={selected.has(player.id) || (!existingSquad && player.status === 'u')} onClick={() => onAddPlayer(player)}>
                {selected.has(player.id) ? 'Added' : !existingSquad && player.status === 'u' ? 'Unavail.'
                  : <><Plus className="h-4 w-4" aria-hidden="true" /> Add</>}
              </button>
            </li>
          );
        })}
      </ul>
      {filtered.length > limit && <button type="button" className="btn-secondary mt-4 w-full" onClick={() => setLimit(limit + 12)}>Show more players</button>}
    </section>
  );
}
