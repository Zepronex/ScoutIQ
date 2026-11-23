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

export function buildSquadFromCandidates(input: SquadOptimizationInput): Squad {
  const maxSpend = roundMoney(input.budget - (input.reservedBank ?? 0));
  if (maxSpend <= 0) {
    throw new Error('invalid_squad_budget');
  }

  const candidates = input.candidates
    .filter(candidate => candidate.availability !== 'unavailable')
    .sort(comparePlayerCandidates);
  const selected: PlayerCandidate[] = [];

  while (selected.length < FPL_RULES.squadSize) {
    const next = candidates.find(candidate => canSelectCandidate(candidate, selected, candidates, maxSpend));
    if (!next) {
      const completion = cheapestLegalCompletion(selected, candidates);
      if (!completion || calculateSquadCost([...selected, ...completion]) > maxSpend) {
        throw new Error('squad_generation_failed');
      }
      selected.push(...completion);
      break;
    }
    selected.push(next);
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

function canSelectCandidate(
  candidate: PlayerCandidate,
  selected: readonly PlayerCandidate[],
  candidates: readonly PlayerCandidate[],
  maxSpend: number
): boolean {
  if (selected.some(player => player.playerId === candidate.playerId)) return false;

  const selectedPositionCounts = countByPosition(selected);
  if (selectedPositionCounts[candidate.position] >= FPL_RULES.squadPositionCounts[candidate.position]) {
    return false;
  }

  const selectedTeamCounts = countByTeam(selected);
  if ((selectedTeamCounts.get(candidate.teamId) ?? 0) >= FPL_RULES.maxPlayersPerTeam) {
    return false;
  }

  const withCandidate = [...selected, candidate];
  const currentCost = calculateSquadCost(withCandidate);
  const minimumRemainingCost = calculateMinimumRemainingCost(withCandidate, candidates);

  return roundMoney(currentCost + minimumRemainingCost) <= maxSpend;
}

function calculateMinimumRemainingCost(
  selected: readonly PlayerCandidate[],
  candidates: readonly PlayerCandidate[]
): number {
  const selectedIds = new Set(selected.map(player => player.playerId));
  const teamCounts = countByTeam(selected);
  const remainingCounts = remainingPositionCounts(selected);
  let cost = 0;

  for (const position of OPTIMIZER_POSITIONS) {
    for (let index = 0; index < remainingCounts[position]; index += 1) {
      const next = cheapestSelectableCandidate(position, candidates, selectedIds, teamCounts);
      if (!next) return Number.POSITIVE_INFINITY;

      selectedIds.add(next.playerId);
      teamCounts.set(next.teamId, (teamCounts.get(next.teamId) ?? 0) + 1);
      cost += next.price;
    }
  }

  return roundMoney(cost);
}

function cheapestSelectableCandidate(
  position: Pos,
  candidates: readonly PlayerCandidate[],
  selectedIds: ReadonlySet<number>,
  teamCounts: ReadonlyMap<number, number>
): PlayerCandidate | null {
  return [...candidates]
    .filter(candidate => candidate.position === position)
    .filter(candidate => !selectedIds.has(candidate.playerId))
    .filter(candidate => (teamCounts.get(candidate.teamId) ?? 0) < FPL_RULES.maxPlayersPerTeam)
    .sort(compareByPriceThenProjection)[0] ?? null;
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

function compareByPriceThenProjection(left: PlayerCandidate, right: PlayerCandidate): number {
  if (left.price !== right.price) return left.price - right.price;
  return comparePlayerCandidates(left, right);
}
