import { useEffect, useReducer } from 'react';
import { EnrichedPlayer, Pos, Squad, SquadSlot } from '../lib/types';
import { isValidFormation } from '../lib/format';

const STORAGE_KEY = 'scoutiq-squad-builder-state';
const INITIAL: Squad = { startingXI: [], bench: [], bank: 100 };
export const SQUAD_LIMITS: Record<Pos, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const MIN_STARTERS: Record<Pos, number> = { GK: 1, DEF: 3, MID: 2, FWD: 1 };
const POSITIONS = Object.keys(SQUAD_LIMITS) as Pos[];

type State = { squad: Squad; error: string | null };
type Action =
  | { type: 'add'; player: EnrichedPlayer }
  | { type: 'remove'; id: number }
  | { type: 'swap'; starter: number; substitute: number }
  | { type: 'mode'; mode: NonNullable<Squad['mode']> }
  | { type: 'bank'; amount?: number }
  | { type: 'price'; id: number; amount?: number }
  | { type: 'catalog'; players: ReadonlyMap<number, EnrichedPlayer> }
  | { type: 'replace'; squad: Squad }
  | { type: 'clear' | 'dismiss' };

export function useSquad() {
  const [{ squad, error }, dispatch] = useReducer(reduceSquad, undefined, () => ({ squad: readSavedSquad(), error: null }));

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(squad));
    } catch {
      // The current tab can still use the squad when storage is unavailable.
    }
  }, [squad]);

  return {
    squad, error, dispatch,
    addPlayer: (player: EnrichedPlayer) => dispatch({ type: 'add', player }),
    clearError: () => dispatch({ type: 'dismiss' })
  };
}

export type SquadState = ReturnType<typeof useSquad>;

function reduceSquad(state: State, action: Action): State {
  const { squad } = state;
  const update = (next: Squad) => ({ squad: updateDraftBank(next), error: null });
  switch (action.type) {
    case 'add': {
      const player = action.player;
      const all = [...squad.startingXI, ...squad.bench];
      if (all.some(slot => slot.id === player.id)) return { squad, error: 'That player is already in your squad.' };
      if (squad.mode !== 'existing' && player.status === 'u') return { squad, error: 'This player is unavailable for a new FPL draft.' };
      if (all.filter(slot => slot.pos === player.pos).length >= SQUAD_LIMITS[player.pos]) {
        return { squad, error: `All ${player.pos} places are filled. Remove a player in that position first.` };
      }
      if (squad.mode !== 'existing' && all.filter(slot => slot.teamId === player.teamId).length >= 3) {
        return { squad, error: `Your draft already has three players from ${player.teamShort}.` };
      }
      const slot = toSquadSlot(player);
      const startingXI = [...squad.startingXI, slot];
      if (canCompleteXI(startingXI)) return update({ ...squad, startingXI: sortByPosition(startingXI) });
      if (squad.bench.length < 4) return update({ ...squad, bench: [...squad.bench, slot] });
      return { squad, error: 'Remove a player before adding another.' };
    }
    case 'remove':
      return update({
        ...squad,
        startingXI: squad.startingXI.filter(player => player.id !== action.id),
        bench: squad.bench.filter(player => player.id !== action.id)
      });
    case 'swap': {
      const out = squad.startingXI.find(player => player.id === action.starter);
      const incoming = squad.bench.find(player => player.id === action.substitute);
      if (!out || !incoming) return state;
      const startingXI = squad.startingXI.map(player => player.id === out.id ? incoming : player);
      if (!canCompleteXI(startingXI)) return { squad, error: 'This swap leaves too few players to complete a legal XI.' };
      return update({
        ...squad,
        startingXI: sortByPosition(startingXI),
        bench: squad.bench.map(player => player.id === incoming.id ? out : player)
      });
    }
    case 'mode':
      if ((squad.mode ?? 'draft') === action.mode) return state;
      return update({ ...squad, mode: action.mode, bankConfirmed: false, bank: 0 });
    case 'bank':
      return update({ ...squad, bank: action.amount ?? 0, bankConfirmed: action.amount !== undefined });
    case 'price': {
      const edit = (slot: SquadSlot) => slot.id === action.id ? { ...slot, sellingPrice: action.amount } : slot;
      return update({ ...squad, startingXI: squad.startingXI.map(edit), bench: squad.bench.map(edit) });
    }
    case 'catalog': {
      const refresh = (slot: SquadSlot) => {
        const player = action.players.get(slot.id);
        return player && matchesSavedPlayer(slot, player) ? { ...slot, ...toSquadSlot(player) } : slot;
      };
      return update({
        ...squad,
        startingXI: sortByPosition(squad.startingXI.map(refresh)),
        bench: squad.bench.map(refresh)
      });
    }
    case 'replace':
      return update(action.squad);
    case 'clear':
      return update({ ...INITIAL, mode: squad.mode, bank: squad.mode === 'existing' ? 0 : 100 });
    case 'dismiss':
      return { squad, error: null };
  }
}

function sortByPosition(slots: SquadSlot[]) {
  return [...slots].sort((left, right) => POSITIONS.indexOf(left.pos) - POSITIONS.indexOf(right.pos));
}

function canCompleteXI(starters: SquadSlot[]): boolean {
  if (starters.length === 11) return isValidFormation(starters);
  if (starters.length > 11 || starters.filter(player => player.pos === 'GK').length > 1) return false;
  const minimumMissing = POSITIONS.reduce((total, pos) =>
    total + Math.max(0, MIN_STARTERS[pos] - starters.filter(player => player.pos === pos).length), 0);
  return starters.length + minimumMissing <= 11;
}

export function canSwap(squad: Squad, starterId: number, substitute: SquadSlot): boolean {
  return canCompleteXI(squad.startingXI.map(player => player.id === starterId ? substitute : player));
}

export function toSquadSlot(player: EnrichedPlayer): SquadSlot {
  const { id, code, name, price, pos, teamId, teamShort } = player;
  return { id, code, name, price, pos, teamId, teamShort };
}

export function matchesSavedPlayer(slot: SquadSlot, player: EnrichedPlayer): boolean {
  if (slot.code != null && player.code != null) return slot.code === player.code;
  return slot.name === undefined || slot.name === player.name;
}

function updateDraftBank(squad: Squad): Squad {
  if (squad.mode === 'existing') return squad;
  const spent = [...squad.startingXI, ...squad.bench].reduce((sum, player) => sum + Math.round(player.price * 10), 0);
  return { ...squad, bank: (1000 - spent) / 10 };
}

function readSavedSquad(): Squad {
  try {
    const serialized = window.localStorage.getItem(STORAGE_KEY) ?? window.sessionStorage.getItem(STORAGE_KEY);
    const saved = JSON.parse(serialized ?? 'null') as Squad | null;
    if (!saved || !Array.isArray(saved.startingXI) || saved.startingXI.length > 11 ||
      !Array.isArray(saved.bench) || saved.bench.length > 4 || !Number.isFinite(saved.bank) ||
      ![undefined, 'draft', 'existing'].includes(saved.mode) ||
      ![...saved.startingXI, ...saved.bench].every(slot => slot && Number.isInteger(slot.id) &&
        slot.id > 0 && POSITIONS.includes(slot.pos) && Number.isFinite(slot.price) && slot.price >= 0)) return INITIAL;
    return updateDraftBank(saved);
  } catch {
    return INITIAL;
  }
}
