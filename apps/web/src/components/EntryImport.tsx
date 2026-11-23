import { FormEvent, useEffect, useRef, useState } from 'react';
import { apiClient, apiErrorMessage } from '../lib/api';
import { Squad } from '../lib/types';

type Preview = { squad: Squad; gameweekId: number; season: string | null };

export default function EntryImport({ onImport, replacing }: { onImport: (squad: Squad) => void; replacing: boolean }) {
  const [entry, setEntry] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState('');
  const request = useRef<AbortController>();

  useEffect(() => () => request.current?.abort(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (request.current) return;
    const id = Number(entry.trim());
    if (!/^\d+$/.test(entry.trim()) || !Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647) {
      setError('Enter the numeric team ID from your FPL Points page address.');
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setError('');
    setLoaded('');
    setPreview(undefined);
    setPending(true);
    try {
      const response = await apiClient.importEntry(id, controller.signal);
      if (!controller.signal.aborted && response.success && response.data) setPreview(response.data);
    } catch (error) {
      if (!controller.signal.aborted) setError(apiErrorMessage(error, 'Could not load your public picks. Try again or add players manually.'));
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  };

  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">Import public FPL picks</summary>
      <div className="mt-3 space-y-3">
        <p className="max-w-2xl text-sm text-slate-600">
          Open Points in Fantasy Premier League and copy the number after <code className="rounded bg-slate-100 px-1">/entry/</code> in the address.
          Import uses the latest published deadline. Update any moves since then and enter your current bank and selling prices.
        </p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit} noValidate>
          <label className="block min-w-0 text-sm font-semibold">FPL team ID
            <input type="text" className="input-field mt-1" inputMode="numeric" autoComplete="off" maxLength={12}
              value={entry} disabled={pending} onChange={event => {
                setEntry(event.target.value); setError(''); setPreview(undefined); setLoaded('');
              }} />
          </label>
          <button type="submit" className="btn-secondary" disabled={pending}>{pending ? 'Looking up picks…' : 'Look up picks'}</button>
        </form>
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        {preview && (
          <div className="space-y-3 rounded-lg bg-slate-100 p-4">
            <p role="status" className="text-sm font-semibold">15 picks from Gameweek {preview.gameweekId}{preview.season ? ` · ${preview.season}` : ''}</p>
            {replacing && <p className="text-sm">Using these picks replaces your saved squad and finance inputs.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => {
                onImport(preview.squad);
                setLoaded(`Imported 15 picks from Gameweek ${preview.gameweekId}.`);
                setEntry('');
                setPreview(undefined);
              }}>{replacing ? 'Replace saved squad' : 'Use these picks'}</button>
              <button type="button" className="btn-secondary" onClick={() => setPreview(undefined)}>Cancel</button>
            </div>
          </div>
        )}
        {loaded && <p role="status" className="text-sm font-semibold text-fpl-green-dark">{loaded}</p>}
      </div>
    </details>
  );
}
