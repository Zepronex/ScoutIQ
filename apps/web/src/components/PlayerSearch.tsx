import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { EnrichedPlayer, Pos } from '../lib/types';
import { formatPrice, normalizePlayerSearch, positionNames } from '../lib/format';

export default function PlayerSearch({ players, selected, existingSquad, onAddPlayer }: {
  players: EnrichedPlayer[];
  selected: Set<number>;
  existingSquad: boolean;
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
    <section className="card min-w-0 space-y-4" aria-labelledby="add-players">
      <h2 className="text-xl font-semibold" id="add-players">Add players</h2>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" aria-hidden="true" />
        <input aria-label="Search squad players" placeholder="Search by name or club" type="search" className="input-field pl-9"
          value={search} onChange={event => { setSearch(event.target.value); setLimit(8); }} />
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Squad player position">
        <button type="button" className="filter-chip" aria-pressed={!position} onClick={() => { setPosition(''); setLimit(8); }}>All</button>
        {(Object.keys(positionNames) as Pos[]).map(pos => (
          <button key={pos} type="button" className="filter-chip" aria-pressed={position === pos} onClick={() => {
            setPosition(pos);
            setLimit(8);
          }}>{pos}</button>
        ))}
      </div>
      <p className="text-sm text-slate-600" role="status">{filtered.length ? `Showing ${Math.min(filtered.length, limit)} of ${filtered.length} players` : 'No players match your search.'}</p>
      <ul className="divide-y divide-slate-200">
        {filtered.slice(0, limit).map(player => (
          <li key={player.id} className="flex items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <Link to={`/player/${player.id}`} className="text-link font-semibold">{player.name}</Link>
              <p className="mt-0.5 text-sm text-slate-600">{player.teamShort} · {player.pos} · {formatPrice(player.price)}</p>
            </div>
            <button type="button" className="btn-secondary shrink-0 text-sm" aria-label={`Add ${player.name}`}
              disabled={selected.has(player.id) || (!existingSquad && player.status === 'u')} onClick={() => onAddPlayer(player)}>
              {selected.has(player.id) ? 'Added' : !existingSquad && player.status === 'u' ? 'Unavailable'
                : <><Plus className="h-4 w-4" aria-hidden="true" /> Add</>}
            </button>
          </li>
        ))}
      </ul>
      {filtered.length > limit && <button className="btn-secondary w-full" onClick={() => setLimit(limit + 12)}>Show more players</button>}
    </section>
  );
}
