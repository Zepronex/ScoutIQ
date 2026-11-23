import { Pos } from '../types';
import { optimizeStartingXi } from './startingXi';
import {
  PlayerCandidate,
  Squad,
  SquadSlot,
  TransferMove,
  TransferOptimizationInput,
  TransferRecommendation
} from './types';
import {
  countByTeam,
  FPL_RULES,
  getSellingPrice,
  OPTIMIZER_POSITIONS,
  roundMoney,
  VALID_FORMATION_ORDER,
  VALID_FORMATIONS,
  validateSquad
} from './rules';

const POINTS_PER_HIT = 4;
const CLUB_LIMIT = FPL_RULES.maxPlayersPerTeam;

type Incoming = { player: PlayerCandidate; cost: number };
type BestPlan = { moves: TransferMove[]; gain: number; cost: number; key: string };

export function recommendTransfers(input: TransferOptimizationInput): TransferRecommendation[] {
  const baseline = optimizeStartingXi(input.currentSquad).totalPredictedPoints;
  const currentIds = new Set(input.currentSquad.slots.map(player => player.playerId));
  const eligible = input.availablePlayers.filter(player =>
    !currentIds.has(player.playerId) && player.availability !== 'unavailable'
  );
  const incomingByPosition = new Map(OPTIMIZER_POSITIONS.map(position => [
    position, eligible.filter(player => player.position === position)
  ]));

  const recommendations: TransferRecommendation[] = [];
  for (const count of [1, 2] as const) {
    const paidTransfers = Math.max(0, count - input.freeTransfers);
    if (paidTransfers > (input.maxHits ?? 0)) continue;
    const hit = paidTransfers * POINTS_PER_HIT;
    const best = findBestPlan(input.currentSquad, incomingByPosition, count, baseline, hit);
    if (best) recommendations.push(buildRecommendation(input.currentSquad, best, count, baseline, hit));
  }
  return recommendations;
}

function findBestPlan(
  squad: Squad,
  incomingByPosition: ReadonlyMap<Pos, PlayerCandidate[]>,
  count: 1 | 2,
  baseline: number,
  hit: number
): BestPlan | undefined {
  const optionsBySlot = squad.slots.map(player => (incomingByPosition.get(player.position) ?? [])
    .map(incoming => ({ player: incoming, cost: Math.round((incoming.price - getSellingPrice(player)) * 10) })));
  const bank = Math.round(squad.bank * 10);
  let best: BestPlan | undefined;

  for (const [index, firstOut] of squad.slots.entries()) {
    const secondIndices = count === 1 ? [-1] : squad.slots.keys();
    for (const secondIndex of secondIndices) {
      if (count === 2 && secondIndex <= index) continue;
      const secondOut = squad.slots[secondIndex];
      const retained = squad.slots.filter((_, i) => i !== index && i !== secondIndex);
      const teamCounts = countByTeam(retained);
      if ([...teamCounts.values()].some(size => size > CLUB_LIMIT)) continue;

      const hasSpace = ({ player }: Incoming) => (teamCounts.get(player.teamId) ?? 0) < CLUB_LIMIT;
      const firstOptions = optionsBySlot[index].filter(hasSpace);
      const secondOptions = secondOut ? optionsBySlot[secondIndex].filter(hasSpace) : [undefined];
      const score = buildLineupScorer(retained);
      for (const first of firstOptions) {
        for (const second of secondOptions) {
          const cost = first.cost + (second?.cost ?? 0);
          if (cost > bank) continue;
          if (second && (first.player.playerId === second.player.playerId ||
            (first.player.teamId === second.player.teamId &&
              (teamCounts.get(first.player.teamId) ?? 0) > CLUB_LIMIT - 2))) continue;

          const gain = roundPoints(roundPoints(score(first.player, second?.player)) - baseline);
          if (gain <= hit || (best && (gain < best.gain || (gain === best.gain && cost > best.cost)))) continue;

          const moves = [toMove(firstOut, first)];
          if (second && secondOut) moves.push(toMove(secondOut, second));
          const key = moves.map(move =>
            `${move.playerOut.playerId}:${move.playerIn.playerName}:${move.playerIn.playerId}`
          ).join('|');
          if (best && gain === best.gain && cost === best.cost && key.localeCompare(best.key) >= 0) continue;
          best = { moves, gain, cost, key };
        }
      }
    }
  }
  return best;
}

// For each set of players sold, precompute what is already on the pitch in every
// formation. Buying a player replaces the lowest-scoring starter in that position
// or fills a vacant spot. The highest-scoring player can captain every formation.
function buildLineupScorer(retained: SquadSlot[]) {
  const byPosition = {} as Record<Pos, number[]>;
  for (const position of OPTIMIZER_POSITIONS) {
    byPosition[position] = retained.filter(player => player.position === position)
      .map(player => player.predictedPoints).sort((left, right) => right - left);
  }
  const topRetained = Math.max(...retained.map(player => player.predictedPoints));
  const formations = VALID_FORMATION_ORDER.map(formation => {
    const counts = VALID_FORMATIONS[formation];
    const total = OPTIMIZER_POSITIONS.reduce((sum, position) =>
      sum + byPosition[position].slice(0, counts[position]).reduce((points, value) => points + value, 0), 0);
    return { counts, total };
  });

  return (first: PlayerCandidate, second?: PlayerCandidate): number => {
    const firstPoints = first.predictedPoints;
    const secondPoints = second?.predictedPoints ?? 0;
    const samePosition = first.position === second?.position;
    const firstGroup = byPosition[first.position];
    const secondGroup = second ? byPosition[second.position] : [];
    let best = 0;
    for (const { counts, total } of formations) {
      const firstCount = counts[first.position];
      const firstCutoff = firstGroup[firstCount - 1] ?? 0;
      let added = Math.max(0, firstPoints - firstCutoff);
      if (samePosition) {
        added = Math.max(0, Math.max(firstPoints, secondPoints) - firstCutoff);
        if (firstCount >= 2) added += Math.max(0, Math.min(firstPoints, secondPoints) - (firstGroup[firstCount - 2] ?? 0));
      } else if (second) {
        added += Math.max(0, secondPoints - (secondGroup[counts[second.position] - 1] ?? 0));
      }
      best = Math.max(best, total + added);
    }
    return best + Math.max(topRetained, firstPoints, secondPoints);
  };
}

function toMove(out: SquadSlot, incoming: Incoming): TransferMove {
  return {
    playerOut: out,
    playerIn: incoming.player,
    predictedPointsDelta: roundPoints(incoming.player.predictedPoints - out.predictedPoints),
    costDelta: incoming.cost / 10
  };
}

function buildRecommendation(
  currentSquad: Squad, plan: BestPlan, transferCount: 1 | 2, baseline: number, pointsHit: number
): TransferRecommendation {
  const replacements = new Map(plan.moves.map(move => [move.playerOut.playerId, move.playerIn]));
  const budgetImpact = plan.cost / 10;
  const bankAfterTransfers = roundMoney(currentSquad.bank - budgetImpact);
  const squadAfterTransfers: Squad = {
    ...currentSquad,
    bank: bankAfterTransfers,
    slots: currentSquad.slots.map(slot => {
      const replacement = replacements.get(slot.playerId);
      return replacement ? { ...replacement, slotIndex: slot.slotIndex } : slot;
    })
  };
  const startingXi = optimizeStartingXi(squadAfterTransfers);
  const expectedPointsGain = roundPoints(startingXi.totalPredictedPoints - baseline);
  return {
    transferCount,
    moves: plan.moves,
    expectedPointsGain,
    pointsHit,
    netExpectedPointsGain: roundPoints(expectedPointsGain - pointsHit),
    budgetImpact,
    bankAfterTransfers,
    squadAfterTransfers,
    startingXi,
    validation: validateSquad(squadAfterTransfers)
  };
}

function roundPoints(value: number): number {
  return Math.round(value * 100) / 100;
}
