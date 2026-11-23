import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { apiClient, apiErrorMessage } from '../lib/api';
import { EnrichedPlayer } from '../lib/types';
import { useDebounce } from '../hooks/useDebounce';
import { formatPrice } from '../lib/format';

type SearchResult = { query: string; players: EnrichedPlayer[]; message?: string };

export default function GlobalPlayerSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SearchResult>();
  const input = useRef<HTMLInputElement>(null);
  const firstResult = useRef<HTMLAnchorElement>(null);
  const trimmed = query.trim();
  const debounced = useDebounce(trimmed, 250);

  useEffect(() => {
    if (!open || trimmed.length < 2 || trimmed !== debounced) return;
    const controller = new AbortController();
    void apiClient.searchPlayer(debounced, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      setResult({
        query: debounced, players: response.data?.slice(0, 8) ?? [],
        message: response.success ? undefined : response.error
      });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({
        query: debounced, players: [], message: apiErrorMessage(error, 'Player search is unavailable.')
      });
    });
    return () => controller.abort();
  }, [open, trimmed, debounced]);

  const current = result?.query === trimmed ? result : undefined;
  const clear = () => {
    setOpen(false);
    setQuery('');
    setResult(undefined);
  };

  return (
    <div className="relative" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={event => {
      if (event.key === 'Escape') {
        input.current?.focus();
        setOpen(false);
      }
    }}>
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-white/55" aria-hidden="true" />
      <input ref={input} className="header-search" type="search" aria-label="Find a player" placeholder="Find a player"
        autoComplete="off" maxLength={100} value={query}
        onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); setResult(undefined); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && current?.players.length) {
            event.preventDefault();
            firstResult.current?.focus();
          }
        }}
      />
      {query && (
        <button type="button" className="absolute inset-y-0 right-0 px-3 text-white/70 hover:text-white" aria-label="Clear player search" onClick={() => {
          input.current?.focus();
          clear();
        }}><X className="h-4 w-4" aria-hidden="true" /></button>
      )}
      {open && trimmed.length >= 2 && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-line-strong bg-paper-raised text-ink shadow-[0_12px_32px_-12px_rgb(21_33_28/0.35)]">
          {current?.players.length ? (
            <ul aria-label="Player search results" className="max-h-72 overflow-y-auto py-1">
              {current.players.map((player, index) => (
                <li key={player.id}>
                  <Link ref={index === 0 ? firstResult : undefined} to={`/player/${player.id}`} onClick={clear}
                    className="block border-b border-line px-4 py-2.5 text-sm last:border-b-0 hover:bg-paper-sunk focus-visible:bg-paper-sunk">
                    <span className="block font-semibold text-ink">{player.name}</span>
                    <span className="text-[13px] text-ink-soft">{player.teamShort} · {player.pos} · {formatPrice(player.price)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p role="status" className="p-4 text-sm text-ink-soft">{current ? current.message ?? 'No matching players.' : 'Searching…'}</p>}
        </div>
      )}
    </div>
  );
}
