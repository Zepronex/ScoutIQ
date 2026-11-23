import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { SquadState, SQUAD_LIMITS, canSwap } from '../state/useSquad';
import { EnrichedPlayer, Pos, SquadSlot } from '../lib/types';
import { formatPrice, getFormationString } from '../lib/format';
import PlayerSearch from './PlayerSearch';

export default function SquadForm({ squadState, players, projections }: {
  squadState: SquadState; players: EnrichedPlayer[]; projections?: ReadonlyMap<number, number>;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const { squad, dispatch } = squadState;
  const all = [...squad.startingXI, ...squad.bench];
  const owned = squad.mode === 'existing';
  const formation = getFormationString(squad.startingXI);

  const renderSlot = (slot: SquadSlot, isBench: boolean) => {
    const name = slot.name ?? `Player ${slot.id}`;
    const options = isBench ? squad.startingXI.filter(starter => canSwap(squad, starter.id, slot)) : [];
    return (
      <li key={slot.id} className="border-b border-line py-2.5">
        <div className="flex items-center gap-2">
          <span className="pos-tag">{slot.pos}</span>
          <div className="min-w-0 flex-1">
            <Link className="text-sm font-semibold text-ink hover:text-pitch-turf" to={`/player/${slot.id}`}>{name}</Link>
            <p className="text-[13px] text-ink-soft">{slot.teamShort} · {formatPrice(slot.price)}</p>
          </div>
          <button type="button" className="icon-button h-9 w-9 shrink-0" aria-label={`Remove ${name}`}
            onClick={() => dispatch({ type: 'remove', id: slot.id })}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        {options.length > 0 && (
          <select className="input-field mt-2 min-h-9 py-1.5 text-[13px]" value="" aria-label={`Start ${name} instead of`}
            onChange={event => dispatch({ type: 'swap', starter: Number(event.target.value), substitute: slot.id })}>
            <option value="" disabled>Swap into XI</option>
            {options.map(starter => <option key={starter.id} value={starter.id}>{starter.name ?? `Player ${starter.id}`}</option>)}
          </select>
        )}
      </li>
    );
  };

  return (
    <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-2">
      <PlayerSearch players={players} selected={new Set(all.map(slot => slot.id))} existingSquad={owned}
        projections={projections} onAddPlayer={squadState.addPlayer} />
      <div className="min-w-0 space-y-10">
        <section aria-labelledby="your-squad">
          <div className="rule-heading">
            <h2 className="section-title" id="your-squad">Your squad <span className="figure ml-1 text-base text-ink-faint">{all.length}/15</span></h2>
            {all.length > 0 && <button type="button" className="text-link text-sm font-semibold" onClick={() => setConfirmClear(!confirmClear)}>Clear squad</button>}
          </div>
          {confirmClear && (
            <div className="notice notice-warning mt-4 flex flex-wrap items-center gap-2">
              <p className="w-full font-medium">Remove all saved players and finance inputs?</p>
              <button type="button" className="btn-danger min-h-9" onClick={() => { dispatch({ type: 'clear' }); setConfirmClear(false); }}>Remove all</button>
              <button type="button" className="btn-secondary min-h-9" onClick={() => setConfirmClear(false)}>Cancel</button>
            </div>
          )}
          <dl className="mt-4 grid grid-cols-5 divide-x divide-line border-b border-line pb-4 text-center">
            {(Object.keys(SQUAD_LIMITS) as Pos[]).map(pos => (
              <div key={pos}>
                <dt className="eyebrow">{pos}</dt>
                <dd className="figure mt-1.5 text-lg">{all.filter(slot => slot.pos === pos).length}<span className="text-ink-faint">/{SQUAD_LIMITS[pos]}</span></dd>
              </div>
            ))}
            <div>
              <dt className="eyebrow">{owned ? 'Value' : 'Bank'}</dt>
              <dd className={`figure mt-1.5 text-lg ${!owned && squad.bank < 0 ? 'text-clay' : ''}`}>
                {formatPrice(owned ? all.reduce((sum, slot) => sum + slot.price, 0) : squad.bank)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm font-semibold text-clay" aria-live="polite">
            {!owned && squad.bank < 0 ? `${formatPrice(-squad.bank)} over budget. Remove or swap a player.` : ''}
          </p>
          <div className="mt-6 grid gap-x-8 gap-y-8 sm:grid-cols-2">
            <div className="min-w-0">
              <h3 className="flex items-baseline justify-between border-b border-line-strong pb-2 text-sm font-bold">
                <span>Starting XI <span className="figure text-ink-faint">{squad.startingXI.length}/11</span></span>
                {formation !== 'Invalid' && <span className="font-medium text-ink-soft">Formation {formation}</span>}
              </h3>
              {squad.startingXI.length ? <ul>{squad.startingXI.map(slot => renderSlot(slot, false))}</ul>
                : <p className="py-3 text-sm text-ink-soft">Add your first player to get started.</p>}
            </div>
            <div className="min-w-0">
              <h3 className="border-b border-line-strong pb-2 text-sm font-bold">Bench <span className="figure text-ink-faint">{squad.bench.length}/4</span></h3>
              {squad.bench.length ? <ul>{squad.bench.map(slot => renderSlot(slot, true))}</ul>
                : <p className="py-3 text-sm text-ink-soft">Players go here when they cannot start.</p>}
            </div>
          </div>
        </section>
        {owned && (
          <section aria-labelledby="transfer-finances">
            <div className="rule-heading">
              <h2 className="section-title" id="transfer-finances">Transfer finances</h2>
            </div>
            <p className="mt-3 text-sm text-ink-soft">Copy your bank and each player’s selling price from the FPL Transfers page. You can preview the lineup while any value is missing.</p>
            <label className="field-label mt-4 max-w-40">
              Bank (£m)
              <MoneyInput value={squad.bankConfirmed ? squad.bank : undefined} max={100}
                onChange={amount => dispatch({ type: 'bank', amount })} />
            </label>
            {!!all.length && (
              <div className="mt-4 border-t border-line">
                {all.map(slot => (
                  <label key={slot.id} className="grid grid-cols-[1fr_6rem] items-center gap-2 border-b border-line py-2 text-sm">
                    <span className="font-medium">{slot.name ?? `Player ${slot.id}`}<span className="block text-[13px] font-normal text-ink-soft">Market {formatPrice(slot.price)}</span></span>
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
