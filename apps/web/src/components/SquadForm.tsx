import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { SquadState, SQUAD_LIMITS, canSwap } from '../state/useSquad';
import { EnrichedPlayer, Pos, SquadSlot } from '../lib/types';
import { formatPrice, getFormationString } from '../lib/format';
import PlayerSearch from './PlayerSearch';

export default function SquadForm({ squadState, players }: { squadState: SquadState; players: EnrichedPlayer[] }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const { squad, dispatch } = squadState;
  const all = [...squad.startingXI, ...squad.bench];
  const owned = squad.mode === 'existing';
  const formation = getFormationString(squad.startingXI);

  const renderSlot = (slot: SquadSlot, isBench: boolean) => {
    const name = slot.name ?? `Player ${slot.id}`;
    const options = isBench ? squad.startingXI.filter(starter => canSwap(squad, starter.id, slot)) : [];
    return (
      <li key={slot.id} className="py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="mr-2 inline-block min-w-8 text-xs font-semibold text-slate-600">{slot.pos}</span>
            <Link className="text-link text-sm font-semibold" to={`/player/${slot.id}`}>{name}</Link>
            <p className="mt-0.5 text-xs text-slate-600">{slot.teamShort} · {formatPrice(slot.price)}</p>
          </div>
          <button type="button" className="icon-button shrink-0" aria-label={`Remove ${name}`}
            onClick={() => dispatch({ type: 'remove', id: slot.id })}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        {options.length > 0 && (
          <select className="input-field mt-2 text-sm" value="" aria-label={`Start ${name} instead of`}
            onChange={event => dispatch({ type: 'swap', starter: Number(event.target.value), substitute: slot.id })}>
            <option value="" disabled>Swap into XI</option>
            {options.map(starter => <option key={starter.id} value={starter.id}>{starter.name ?? `Player ${starter.id}`}</option>)}
          </select>
        )}
      </li>
    );
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_1fr]">
      <PlayerSearch players={players} selected={new Set(all.map(slot => slot.id))} existingSquad={owned} onAddPlayer={squadState.addPlayer} />
      <div className="min-w-0 space-y-4">
        <section className="card" aria-labelledby="your-squad">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold" id="your-squad">Your squad <span className="ml-1 text-sm text-slate-600">{all.length}/15</span></h2>
            {all.length > 0 && <button type="button" className="text-link text-sm" onClick={() => setConfirmClear(!confirmClear)}>Clear squad</button>}
          </div>
          {confirmClear && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm">
              <p className="w-full">Remove all saved players and finance inputs?</p>
              <button type="button" className="btn-danger" onClick={() => { dispatch({ type: 'clear' }); setConfirmClear(false); }}>Remove all</button>
              <button type="button" className="btn-secondary" onClick={() => setConfirmClear(false)}>Cancel</button>
            </div>
          )}
          <div className="mt-4 grid grid-cols-4 divide-x divide-slate-200 rounded-lg bg-slate-100 py-2 text-center text-sm">
            {(Object.keys(SQUAD_LIMITS) as Pos[]).map(pos => (
              <div key={pos}>
                <span className="block text-xs font-semibold text-slate-600">{pos}</span>
                <span className="font-semibold tabular-nums">{all.filter(slot => slot.pos === pos).length}/{SQUAD_LIMITS[pos]}</span>
              </div>
            ))}
          </div>
          {!owned && (
            <p className={`mt-3 text-sm font-semibold ${squad.bank < 0 ? 'text-red-800' : 'text-slate-700'}`} aria-live="polite">
              {squad.bank < 0 ? `${formatPrice(-squad.bank)} over budget` : `${formatPrice(squad.bank)} left in the draft budget`}
            </p>
          )}
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div className="min-w-0">
              <h3 className="border-b border-slate-300 pb-2 font-semibold">Starting XI <span className="text-sm text-slate-600">{squad.startingXI.length}/11</span></h3>
              {formation !== 'Invalid' && <p className="mt-2 text-sm font-medium text-fpl-green-dark">Formation {formation}</p>}
              {squad.startingXI.length ? <ul className="divide-y divide-slate-100">{squad.startingXI.map(slot => renderSlot(slot, false))}</ul>
                : <p className="py-3 text-sm text-slate-600">Add your first player to get started.</p>}
            </div>
            <div className="min-w-0">
              <h3 className="border-b border-slate-300 pb-2 font-semibold">Bench <span className="text-sm text-slate-600">{squad.bench.length}/4</span></h3>
              {squad.bench.length ? <ul className="divide-y divide-slate-100">{squad.bench.map(slot => renderSlot(slot, true))}</ul>
                : <p className="py-3 text-sm text-slate-600">Players go here when they cannot start.</p>}
            </div>
          </div>
        </section>
        {owned && (
          <section className="card space-y-3">
            <h2 className="text-xl font-semibold">Transfer finances</h2>
            <p className="text-sm text-slate-600">Copy your bank and each player’s selling price from the FPL Transfers page. You can preview the lineup while any value is missing.</p>
            <label className="block max-w-52 text-sm font-medium">
              Bank (£m)
              <MoneyInput value={squad.bankConfirmed ? squad.bank : undefined} max={100}
                onChange={amount => dispatch({ type: 'bank', amount })} />
            </label>
            {!!all.length && (
              <div className="divide-y divide-slate-100">
                {all.map(slot => (
                  <label key={slot.id} className="grid grid-cols-[1fr_6rem] items-center gap-2 py-2 text-sm">
                    <span>{slot.name ?? `Player ${slot.id}`}<span className="block text-xs text-slate-600">Market {formatPrice(slot.price)}</span></span>
                    <MoneyInput label={`Selling price for ${slot.name ?? slot.id} (£m)`} value={slot.sellingPrice}
                      max={slot.price} onChange={amount => dispatch({ type: 'price', id: slot.id, amount })} />
                  </label>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function MoneyInput({ label, value, max, onChange }: {
  label?: string; value?: number; max: number; onChange: (value: number | undefined) => void;
}) {
  return (
    <input aria-label={label} className="input-field mt-1 tabular-nums" type="number" inputMode="decimal"
      min={label ? 0.1 : 0} max={max} step="0.1" placeholder="—" value={value ?? ''}
      onChange={event => onChange(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : undefined)} />
  );
}
