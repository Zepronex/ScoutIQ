import { Pos } from '../types';
import { OptimizerInputError } from './errors';
import {
  FPL_RULES,
  OPTIMIZER_POSITIONS,
  calculateSquadCost,
  countByPosition,
  countByTeam,
  roundMoney,
  validateSquad
} from './rules';
import { comparePlayerCandidates } from './startingXi';
import { PlayerCandidate, Squad, SquadOptimizationInput, SquadSlot } from './types';

// Bench players only score when a starter misses out, so they count for a
// fraction of their projection when the budget is divided.
const BENCH_WEIGHT = 0.15;
const CAPTAIN_TRIALS = 3;
const MAX_CLUB_REPAIRS = 12;

export function buildSquadFromCandidates(input: SquadOptimizationInput): Squad {
  const maxSpend = roundMoney(input.budget - (input.reservedBank ?? 0));
  if (maxSpend <= 0) {
    throw new Error('invalid_squad_budget');
  }

  const candidates = [...new Map(input.candidates
    .filter(candidate => candidate.availability !== 'unavailable')
    .map(candidate => [candidate.playerId, candidate])).values()]
    .sort(comparePlayerCandidates);

  let selected = bestSquadWithinBudget(candidates, maxSpend);
  if (!selected) {
    // The search ignores club limits until a repair pass. When repairs run out,
    // fall back to the cheapest squad that satisfies every rule.
    selected = cheapestLegalCompletion([], candidates);
    if (!selected || calculateSquadCost(selected) > maxSpend) {
      throw new Error('squad_generation_failed');
    }
  }

  const ordered = orderSquadCandidates(selected);
  const squad: Squad = {
    budget: input.budget,
    bank: roundMoney(input.budget - calculateSquadCost(ordered)),
    slots: ordered.map((candidate, index) => ({
      ...candidate,
      slotIndex: index
    }))
  };

  const validation = validateSquad(squad);
  if (!validation.valid) {
    throw new OptimizerInputError('invalid_generated_squad', validation);
  }

  return squad;
}

type Pick = { starters: PlayerCandidate[]; bench: PlayerCandidate[]; value: number };
type PositionTable = {
  items: PlayerCandidate[];
  best: Float64Array;
  choice: Uint8Array;
  states: number;
  benchSlots: number;
};

const toUnits = (price: number) => Math.round(price * 10);

/**
 * Chooses the 15 players that maximise projected starting points within the
 * budget. Each position is solved as a knapsack over price in £0.1m steps, the
 * positions are then combined for every legal formation, and club limits are
 * enforced by excluding the weakest surplus player and solving again.
 */
function bestSquadWithinBudget(candidates: readonly PlayerCandidate[], maxSpend: number): PlayerCandidate[] | null {
  const captains = [...candidates].sort(comparePlayerCandidates).slice(0, CAPTAIN_TRIALS);
  let best: Pick | null = null;
  for (const captain of captains.length ? captains : [undefined]) {
    const pick = solveWithClubLimits(candidates, maxSpend, captain?.playerId);
    if (pick && (!best || pick.value > best.value)) best = pick;
  }
  return best ? [...best.starters, ...best.bench] : null;
}

function solveWithClubLimits(
  candidates: readonly PlayerCandidate[], maxSpend: number, captainId: number | undefined
): Pick | null {
  const excluded = new Set<number>();
  for (let attempt = 0; attempt <= MAX_CLUB_REPAIRS; attempt += 1) {
    const pick = solveIgnoringClubs(candidates.filter(player => !excluded.has(player.playerId)), maxSpend, captainId);
    if (!pick) return null;
    const squad = [...pick.starters, ...pick.bench];
    const crowded = [...countByTeam(squad)].find(([, count]) => count > FPL_RULES.maxPlayersPerTeam);
    if (!crowded) return pick;
    const starterIds = new Set(pick.starters.map(player => player.playerId));
    const weakest = squad.filter(player => player.teamId === crowded[0])
      .sort((left, right) => Number(starterIds.has(left.playerId)) - Number(starterIds.has(right.playerId))
        || -comparePlayerCandidates(left, right))[0];
    excluded.add(weakest.playerId);
  }
  return null;
}

function solveIgnoringClubs(
  candidates: readonly PlayerCandidate[], maxSpend: number, captainId: number | undefined
): Pick | null {
  const priciest = [...candidates].sort((left, right) => right.price - left.price)
    .slice(0, FPL_RULES.squadSize).reduce((sum, player) => sum + toUnits(player.price), 0);
  const budget = Math.min(toUnits(maxSpend), priciest);
  const points = (player: PlayerCandidate) => player.predictedPoints * (player.playerId === captainId ? 2 : 1);
  const tables = new Map(OPTIMIZER_POSITIONS.map(position => [
    position,
    buildPositionTable(undominated(candidates.filter(player => player.position === position),
      FPL_RULES.squadPositionCounts[position]), position, budget, points)
  ]));

  let best: Pick | null = null;
  for (const formation of Object.values(FPL_RULES.validFormations)) {
    // totals[b] is the best value for the positions combined so far at exactly b spent.
    let totals = new Float64Array(budget + 1).fill(Number.NEGATIVE_INFINITY);
    totals[0] = 0;
    const splits: Int32Array[] = [];
    for (const position of OPTIMIZER_POSITIONS) {
      const table = tables.get(position)!;
      const offset = stateIndex(table, formation[position], FPL_RULES.squadPositionCounts[position] - formation[position]);
      const next = new Float64Array(budget + 1).fill(Number.NEGATIVE_INFINITY);
      const split = new Int32Array(budget + 1).fill(-1);
      for (let spent = 0; spent <= budget; spent += 1) {
        if (totals[spent] === Number.NEGATIVE_INFINITY) continue;
        for (let cost = 0; spent + cost <= budget; cost += 1) {
          const value = table.best[offset * (budget + 1) + cost];
          if (value === Number.NEGATIVE_INFINITY) continue;
          if (totals[spent] + value > next[spent + cost]) {
            next[spent + cost] = totals[spent] + value;
            split[spent + cost] = cost;
          }
        }
      }
      totals = next;
      splits.push(split);
    }

    let spent = -1;
    for (let cost = 0; cost <= budget; cost += 1) {
      if (totals[cost] > (spent < 0 ? Number.NEGATIVE_INFINITY : totals[spent]) + 1e-9) spent = cost;
    }
    if (spent < 0 || (best && totals[spent] <= best.value + 1e-9)) continue;

    const pick: Pick = { starters: [], bench: [], value: totals[spent] };
    for (let index = OPTIMIZER_POSITIONS.length - 1; index >= 0; index -= 1) {
      const position = OPTIMIZER_POSITIONS[index];
      const cost = splits[index][spent];
      readPositionChoice(tables.get(position)!, formation[position],
        FPL_RULES.squadPositionCounts[position] - formation[position], cost, budget, pick);
      spent -= cost;
    }
    best = pick;
  }
  return best;
}

function stateIndex(table: PositionTable, starters: number, bench: number): number {
  return starters * (table.benchSlots + 1) + bench;
}

function buildPositionTable(
  items: PlayerCandidate[], position: Pos, budget: number, points: (player: PlayerCandidate) => number
): PositionTable {
  const slots = FPL_RULES.squadPositionCounts[position];
  const minStarters = Math.min(...Object.values(FPL_RULES.validFormations).map(formation => formation[position]));
  const benchSlots = slots - minStarters;
  const states = (slots + 1) * (benchSlots + 1);
  const width = budget + 1;
  const best = new Float64Array(states * width).fill(Number.NEGATIVE_INFINITY);
  const choice = new Uint8Array(items.length * states * width);
  const table = { items, best, choice, states, benchSlots };
  best[0] = 0;

  items.forEach((player, item) => {
    const cost = toUnits(player.price);
    const starterValue = points(player);
    const benchValue = player.predictedPoints * BENCH_WEIGHT;
    // Walk states and budgets downwards so each player is used at most once.
    for (let starters = slots; starters >= 0; starters -= 1) {
      for (let bench = Math.min(benchSlots, slots - starters); bench >= 0; bench -= 1) {
        const state = stateIndex(table, starters, bench) * width;
        const asStarter = starters > 0 ? stateIndex(table, starters - 1, bench) * width : -1;
        const asBench = bench > 0 ? stateIndex(table, starters, bench - 1) * width : -1;
        for (let spent = budget; spent >= cost; spent -= 1) {
          let value = best[state + spent];
          let used = 0;
          if (asStarter >= 0 && best[asStarter + spent - cost] + starterValue > value) {
            value = best[asStarter + spent - cost] + starterValue;
            used = 1;
          }
          if (asBench >= 0 && best[asBench + spent - cost] + benchValue > value) {
            value = best[asBench + spent - cost] + benchValue;
            used = 2;
          }
          if (used) {
            best[state + spent] = value;
            choice[(item * states + state / width) * width + spent] = used;
          }
        }
      }
    }
  });
  return table;
}

function readPositionChoice(
  table: PositionTable, starters: number, bench: number, cost: number, budget: number, pick: Pick
): void {
  const width = budget + 1;
  for (let item = table.items.length - 1; item >= 0; item -= 1) {
    const used = table.choice[(item * table.states + stateIndex(table, starters, bench)) * width + cost];
    if (!used) continue;
    const player = table.items[item];
    if (used === 1) {
      pick.starters.push(player);
      starters -= 1;
    } else {
      pick.bench.push(player);
      bench -= 1;
    }
    cost -= toUnits(player.price);
  }
}

// A player can be left out of the search when enough others in the position
// cost no more and project no fewer points. The margin leaves room for club
// limits to rule some of those alternatives out.
function undominated(players: readonly PlayerCandidate[], slots: number): PlayerCandidate[] {
  const margin = slots + FPL_RULES.maxPlayersPerTeam * 2;
  return players.filter(player => players.filter(other => other.playerId !== player.playerId &&
    other.price <= player.price && other.predictedPoints >= player.predictedPoints &&
    (other.price < player.price || other.predictedPoints > player.predictedPoints ||
      other.playerId < player.playerId)).length < margin);
}

type Edge = { to: number; cost: number; capacity: number; reverse: number };

// A minimum-cost flow reserves the remaining position and club slots together
// when the greedy budget check cannot find a completion.
function cheapestLegalCompletion(
  selected: readonly PlayerCandidate[], candidates: readonly PlayerCandidate[]
): PlayerCandidate[] | null {
  const selectedIds = new Set(selected.map(player => player.playerId));
  const eligible = [...new Map(candidates.filter(player => !selectedIds.has(player.playerId))
    .map(player => [player.playerId, player])).values()];
  const needed = remainingPositionCounts(selected);
  const teamCounts = countByTeam(selected);
  const source = 0;
  const positionNodes = new Map(OPTIMIZER_POSITIONS.map((position, index) => [position, index + 1]));
  const clubs = [...new Set(eligible.map(player => player.teamId))];
  const teamNodes = new Map(clubs.map((team, index) => [team, index + positionNodes.size + 1]));
  const sink = positionNodes.size + teamNodes.size + 1;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);

  const connect = (from: number, to: number, capacity: number, cost = 0): Edge => {
    const forward = { to, cost, capacity, reverse: graph[to].length };
    graph[to].push({ to: from, cost: -cost, capacity: 0, reverse: graph[from].length });
    graph[from].push(forward);
    return forward;
  };
  for (const [position, node] of positionNodes) connect(source, node, needed[position]);
  for (const [team, node] of teamNodes) connect(node, sink, FPL_RULES.maxPlayersPerTeam - (teamCounts.get(team) ?? 0));
  const playerEdges = eligible.map(player => ({
    player,
    edge: connect(positionNodes.get(player.position)!, teamNodes.get(player.teamId)!, 1, Math.round(player.price * 10))
  }));

  for (let remaining = FPL_RULES.squadSize - selected.length; remaining > 0; remaining -= 1) {
    if (!augmentCheapestPath(graph, source, sink)) return null;
  }
  return playerEdges.filter(({ edge }) => edge.capacity === 0).map(({ player }) => player);
}

function augmentCheapestPath(graph: Edge[][], source: number, sink: number): boolean {
  const distance = graph.map(() => Number.POSITIVE_INFINITY);
  const previous: Array<{ from: number; edge: Edge } | undefined> = [];
  distance[source] = 0;

  // Residual edges can refund a prior player selection, so use Bellman-Ford.
  for (let pass = 0; pass < graph.length - 1; pass += 1) {
    let changed = false;
    for (const [from, edges] of graph.entries()) {
      for (const edge of edges) {
        const cost = distance[from] + edge.cost;
        if (edge.capacity > 0 && cost < distance[edge.to]) {
          distance[edge.to] = cost;
          previous[edge.to] = { from, edge };
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  if (!previous[sink]) return false;
  for (let node = sink; node !== source;) {
    const step = previous[node]!;
    step.edge.capacity -= 1;
    graph[node][step.edge.reverse].capacity += 1;
    node = step.from;
  }
  return true;
}

function remainingPositionCounts(selected: readonly PlayerCandidate[]): Record<Pos, number> {
  const selectedCounts = countByPosition(selected);
  return {
    GK: FPL_RULES.squadPositionCounts.GK - selectedCounts.GK,
    DEF: FPL_RULES.squadPositionCounts.DEF - selectedCounts.DEF,
    MID: FPL_RULES.squadPositionCounts.MID - selectedCounts.MID,
    FWD: FPL_RULES.squadPositionCounts.FWD - selectedCounts.FWD
  };
}

function orderSquadCandidates(candidates: readonly PlayerCandidate[]): SquadSlot[] {
  return OPTIMIZER_POSITIONS.flatMap(position =>
    candidates
      .filter(candidate => candidate.position === position)
      .sort(comparePlayerCandidates)
  ).map((candidate, index) => ({
    ...candidate,
    slotIndex: index
  }));
}
