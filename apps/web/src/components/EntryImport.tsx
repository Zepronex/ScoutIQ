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
    <details className="group rounded-md border border-line bg-paper-raised">
      <summary className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold marker:content-['']">
        <span>Import public FPL picks</span>
        <span className="text-ink-faint transition-transform group-open:rotate-45" aria-hidden="true">+</span>
      </summary>
      <div className="space-y-3 border-t border-line px-4 py-4">
        <p className="max-w-2xl text-sm text-ink-soft">
          Open Points in Fantasy Premier League and copy the number after <code className="rounded bg-paper-sunk px-1 text-[13px]">/entry/</code> in the address.
          Import uses the latest published deadline. Update any moves since then and enter your current bank and selling prices.
        </p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit} noValidate>
          <label className="field-label min-w-0">FPL team ID
            <input type="text" className="input-field mt-1 w-40" inputMode="numeric" autoComplete="off" maxLength={12}
              value={entry} disabled={pending} onChange={event => {
                setEntry(event.target.value); setError(''); setPreview(undefined); setLoaded('');
              }} />
          </label>
          <button type="submit" className="btn-secondary" disabled={pending}>{pending ? 'Looking up picks…' : 'Look up picks'}</button>
        </form>
        {error && <p role="alert" className="text-sm font-medium text-clay">{error}</p>}
        {preview && (
          <div className="panel-sunk space-y-3">
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
        {loaded && <p role="status" className="text-sm font-semibold text-pitch-turf">{loaded}</p>}
      </div>
    </details>
  );
}
