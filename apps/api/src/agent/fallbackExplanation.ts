import {
  AgentFallbackReasonCode,
  RecommendationExplanation,
  RecommendationExplanationInput,
  RecommendationExplanationSchema
} from './schemas';

type FallbackExplanationOptions = {
  fallbackReasonCode?: AgentFallbackReasonCode;
  providerConfigured?: boolean;
};

export function buildFallbackExplanation(
  input: RecommendationExplanationInput,
  fallbackReason = 'Agent provider is disabled or unavailable.',
  options: FallbackExplanationOptions = {}
): RecommendationExplanation {
  const topTransfer = input.transferRecommendations[0];
  const invalidTransfer = input.transferRecommendations.find(recommendation => !recommendation.validation.valid);
  const players = collectPlayers(input);
  const unavailablePlayers = uniquePlayers(players)
    .filter(player => player.availability === 'doubtful' || player.availability === 'unavailable');
  const playersMissingPredictionRun = uniquePlayers(players)
    .filter(player => player.predictionRunId === undefined);

  const explanation = {
    summary: buildSummary(input, topTransfer),
    recommendedActions: buildRecommendedActions(input, topTransfer),
    startingXiReasoning: buildStartingXiReasoning(input),
    captaincyReasoning: buildCaptaincyReasoning(input),
    transferReasoning: buildTransferReasoning(input),
    risks: buildRisks(input, unavailablePlayers, invalidTransfer),
    alternatives: buildAlternatives(input),
    dataLimitations: buildDataLimitations(input, playersMissingPredictionRun),
    constraintSummary: buildConstraintSummary(input, invalidTransfer),
    disclaimer: 'Projections are estimates, so check team news before the deadline.',
    provider: 'deterministic_fallback' as const,
    usedFallback: true,
    fallbackReason,
    agentStatus: {
      mode: 'deterministic_fallback' as const,
      provider: 'deterministic_fallback' as const,
      providerConfigured: options.providerConfigured ?? false,
      fallbackReasonCode: options.fallbackReasonCode,
      message: fallbackReason
    }
  };

  return RecommendationExplanationSchema.parse(explanation);
}

function buildSummary(
  input: RecommendationExplanationInput,
  topTransfer: RecommendationExplanationInput['transferRecommendations'][number] | undefined
): string {
  const xi = input.startingXi;
  if (!topTransfer) {
    return `Line up ${xi.formation} for a projected ${formatPoints(xi.totalPredictedPoints)} with ${xi.captaincy.captain.playerName} as captain. No transfer was compared, or none improved on keeping your squad.`;
  }

  return `Line up ${xi.formation} for a projected ${formatPoints(xi.totalPredictedPoints)} with ${xi.captaincy.captain.playerName} as captain. The best transfer found is worth ${formatSignedPoints(topTransfer.netExpectedPointsGain)} after any points hit.`;
}

function buildRecommendedActions(
  input: RecommendationExplanationInput,
  topTransfer: RecommendationExplanationInput['transferRecommendations'][number] | undefined
): string[] {
  const actions = [
    `Start ${input.startingXi.starters.map(player => player.playerName).join(', ')}.`,
    `Captain ${input.startingXi.captaincy.captain.playerName}, with ${input.startingXi.captaincy.viceCaptain.playerName} as vice-captain.`,
    `Bench, in order: ${input.startingXi.bench.map(player => player.playerName).join(', ')}.`
  ];

  if (topTransfer) {
    actions.push(`Best transfer: ${formatTransferMoves(topTransfer)}.`);
  } else {
    actions.push('Keep your transfers unless a later comparison shows a gain.');
  }

  return actions;
}

function buildStartingXiReasoning(input: RecommendationExplanationInput): string[] {
  const xi = input.startingXi;
  const highestStarter = [...xi.starters].sort(sortByPredictedPointsDesc)[0];
  const lowestBench = [...xi.bench].sort(sortByPredictedPointsDesc)[0];

  return [
    `${xi.formation} scores highest of the formations your 15 players can fill.`,
    `The total of ${formatPoints(xi.totalPredictedPoints)} counts the captain twice.`,
    `${highestStarter.playerName} has the highest projection in the XI at ${formatPoints(highestStarter.predictedPoints)}.`,
    `${lowestBench.playerName} is the strongest player left on the bench at ${formatPoints(lowestBench.predictedPoints)}.`
  ];
}

function buildCaptaincyReasoning(input: RecommendationExplanationInput): string[] {
  const { captaincy } = input.startingXi;

  return [
    `${captaincy.captain.playerName} takes the armband on ${formatPoints(captaincy.captainPredictedPoints)}, the highest projection among your starters.`,
    `${captaincy.viceCaptain.playerName} is vice-captain on ${formatPoints(captaincy.viceCaptainPredictedPoints)} and takes over if the captain does not play.`
  ];
}

function buildTransferReasoning(input: RecommendationExplanationInput): string[] {
  if (input.transferRecommendations.length === 0) {
    return ['No transfer options have been compared for this plan.'];
  }

  return input.transferRecommendations.slice(0, 3).map((recommendation, index) => {
    const rank = index + 1;
    return `Option ${rank}: ${formatTransferMoves(recommendation)} adds ${formatSignedPoints(recommendation.expectedPointsGain)} to the projected XI${recommendation.pointsHit ? `, costs a ${recommendation.pointsHit}-point hit` : ' with no hit'}, for a net ${formatSignedPoints(recommendation.netExpectedPointsGain)}.`;
  });
}

function buildRisks(
  input: RecommendationExplanationInput,
  unavailablePlayers: ReturnType<typeof collectPlayers>,
  invalidTransfer: RecommendationExplanationInput['transferRecommendations'][number] | undefined
): string[] {
  const risks: string[] = [];

  if (!input.startingXi.constraintSummary.valid) {
    risks.push(`Starting XI constraints are invalid: ${formatViolations(input.startingXi.constraintSummary.violations)}.`);
  }

  if (invalidTransfer) {
    risks.push(`At least one transfer option has invalid constraints: ${formatViolations(invalidTransfer.validation.violations)}.`);
  }

  if (unavailablePlayers.length > 0) {
    risks.push(`Check the fitness of ${unavailablePlayers.map(player => player.playerName).join(', ')} before the deadline. FPL has flagged them.`);
  }

  if (input.transferRecommendations.some(recommendation => recommendation.netExpectedPointsGain < 0)) {
    risks.push('At least one transfer option loses points once the hit is counted.');
  }

  return risks.length > 0 ? risks : ['No player in this plan is flagged as doubtful or unavailable.'];
}

function buildAlternatives(input: RecommendationExplanationInput): string[] {
  const alternatives = input.transferRecommendations.slice(1, 4).map((recommendation, index) => {
    return `${formatTransferMoves(recommendation)} for a net ${formatSignedPoints(recommendation.netExpectedPointsGain)}.`;
  });

  if (alternatives.length > 0) return alternatives;
  return [];
}

function buildDataLimitations(
  input: RecommendationExplanationInput,
  playersMissingPredictionRun: ReturnType<typeof collectPlayers>
): string[] {
  const limitations: string[] = [];

  if (input.predictionRunIds.length === 0) {
    limitations.push('No prediction run id was supplied with the optimizer result.');
  }

  if (!input.targetGameweekId) {
    limitations.push('No target gameweek id was supplied with the optimizer result.');
  }

  if (playersMissingPredictionRun.length > 0) {
    limitations.push(`${playersMissingPredictionRun.length} ${playersMissingPredictionRun.length === 1 ? 'player has' : 'players have'} no projection for this gameweek.`);
  }

  limitations.push('Projections cover this gameweek only and use the FPL data captured at the last refresh.');

  return limitations;
}

function buildConstraintSummary(
  input: RecommendationExplanationInput,
  invalidTransfer: RecommendationExplanationInput['transferRecommendations'][number] | undefined
): string[] {
  const xiValidation = input.startingXi.constraintSummary;
  const summary = [
    xiValidation.valid
      ? `The lineup passes all ${xiValidation.checks.length} FPL squad and formation rules.`
      : `Starting XI constraints failed ${xiValidation.violations.length} check(s): ${formatViolations(xiValidation.violations)}.`
  ];

  if (input.transferRecommendations.length === 0) {
    // Nothing to add when no transfer was compared.
  } else if (invalidTransfer) {
    summary.push(`Transfer constraints include an invalid option: ${formatViolations(invalidTransfer.validation.violations)}.`);
  } else {
    summary.push(input.transferRecommendations.length === 1
      ? 'The transfer option keeps the squad within budget and club limits.'
      : `All ${input.transferRecommendations.length} transfer options keep the squad within budget and club limits.`);
  }

  return summary;
}

function collectPlayers(input: RecommendationExplanationInput) {
  const transferPlayers = input.transferRecommendations.flatMap(recommendation => [
    ...recommendation.moves.flatMap(move => [move.playerOut, move.playerIn]),
    ...recommendation.squadAfterTransfers.slots,
    ...recommendation.startingXi.starters,
    ...recommendation.startingXi.bench
  ]);

  return [
    ...input.startingXi.starters,
    ...input.startingXi.bench,
    ...transferPlayers
  ];
}

function uniquePlayers<T extends { playerId: number }>(players: T[]): T[] {
  const seen = new Set<number>();
  return players.filter(player => {
    if (seen.has(player.playerId)) return false;
    seen.add(player.playerId);
    return true;
  });
}

function sortByPredictedPointsDesc(
  left: { predictedPoints: number; playerId: number },
  right: { predictedPoints: number; playerId: number }
): number {
  return right.predictedPoints - left.predictedPoints || left.playerId - right.playerId;
}

function formatTransferMoves(recommendation: RecommendationExplanationInput['transferRecommendations'][number]): string {
  return recommendation.moves
    .map(move => `${move.playerOut.playerName} to ${move.playerIn.playerName}`)
    .join(', ');
}

function formatViolations(
  violations: Array<{ key: string; expected: number | string | Record<string, number>; actual: number | string | Record<string, number> }>
): string {
  if (violations.length === 0) return 'no violation details supplied';

  return violations
    .slice(0, 3)
    .map(violation => `${humanizeKey(violation.key)} expected ${formatConstraintValue(violation.expected)} and got ${formatConstraintValue(violation.actual)}`)
    .join('; ');
}

function humanizeKey(value: string): string {
  return value
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatConstraintValue(value: number | string | Record<string, number>): string {
  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }

  return Object.entries(value)
    .map(([key, entryValue]) => `${key}: ${entryValue}`)
    .join(', ');
}

function formatPoints(value: number): string {
  return `${formatNumber(value)} pts`;
}

function formatSignedPoints(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatNumber(value)} pts`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
