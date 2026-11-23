import { Router, Response, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { getServerPool, Queryable } from '../db/client';
import {
  readGameweekPredictionSummary,
  readPlanningPredictions,
  readPlanningWindow
} from '../db/predictionQueries';
import { readBlankGameweekCandidates } from '../db/playerQueries';
import { decorateStartingXiScores, decorateTransferScores } from '../optimizer/displayScores';
import { OptimizerInputError } from '../optimizer/errors';
import { predictionsToCandidates } from '../optimizer/predictionAdapter';
import { buildSquadFromCandidates } from '../optimizer/squadBuilder';
import { optimizeStartingXi } from '../optimizer/startingXi';
import { recommendTransfers } from '../optimizer/transfers';
import { calculateSquadCost, roundMoney } from '../optimizer/rules';
import { PlayerCandidate, Squad, SquadSlot } from '../optimizer/types';

const PositionSchema = z.enum(['GK', 'DEF', 'MID', 'FWD']);
const AvailabilitySchema = z.enum(['available', 'doubtful', 'unavailable', 'unknown']);
const PositiveIdSchema = z.coerce.number().int().positive().max(2_147_483_647);
const MoneySchema = z.coerce.number().finite().min(0).max(1000);
const FplMoneySchema = z.union([z.number(), z.string().regex(/^\d+(\.\d)?$/).transform(Number)])
  .pipe(z.number().min(0).max(1000).multipleOf(0.1));

const PlayerCandidateSchema = z.object({
  playerId: PositiveIdSchema,
  playerName: z.string().min(1).max(100),
  shortName: z.string().min(1).max(60).optional(),
  position: PositionSchema,
  teamId: PositiveIdSchema,
  teamName: z.string().min(1).max(100).optional(),
  teamShortName: z.string().min(1).max(10).optional(),
  price: MoneySchema,
  predictedPoints: z.coerce.number().finite().nonnegative(),
  predictionRunId: PositiveIdSchema.optional(),
  targetGameweekId: PositiveIdSchema.optional(),
  fixtureId: PositiveIdSchema.nullable().optional(),
  availability: AvailabilitySchema.optional()
});

const SquadInputSchema = z.object({
  slots: z.array(PlayerCandidateSchema).length(15).optional(),
  playerIds: z.array(PositiveIdSchema).length(15).optional(),
  bank: FplMoneySchema.optional(),
  budget: MoneySchema.default(100),
  existingSquad: z.boolean().optional(),
  sellingPrices: z.record(z.string().regex(/^[1-9]\d*$/), FplMoneySchema.refine(value => value > 0)).optional()
}).superRefine((value, context) => {
  if (!value.slots && !value.playerIds) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['slots'],
      message: 'Provide either slots or playerIds'
    });
  }
});

const StartingXiRequestSchema = z.object({
  squad: SquadInputSchema,
  gameweekId: PositiveIdSchema.optional(),
  predictionRunId: PositiveIdSchema.optional()
});

const TransfersRequestSchema = z.object({
  currentSquad: SquadInputSchema,
  availablePlayers: z.array(PlayerCandidateSchema).max(1200).optional(),
  gameweekId: PositiveIdSchema.optional(),
  predictionRunId: PositiveIdSchema.optional(),
  freeTransfers: z.coerce.number().int().min(0).max(5),
  maxHits: z.coerce.number().int().min(0).max(2).optional()
});

const SquadBuildRequestSchema = z.object({
  availablePlayers: z.array(PlayerCandidateSchema).max(1200).optional(),
  gameweekId: PositiveIdSchema.optional(),
  predictionRunId: PositiveIdSchema.optional(),
  budget: MoneySchema.default(100),
  reservedBank: MoneySchema.optional()
});

type SquadInput = z.infer<typeof SquadInputSchema>;

class OptimizerRouteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(code);
    this.name = 'OptimizerRouteError';
  }
}

export function createOptimizerRouter(client: Queryable = getServerPool()): ExpressRouter {
  const router: ExpressRouter = Router();

  router.post('/starting-xi', async (req, res) => {
    try {
      const request = StartingXiRequestSchema.parse(req.body);
      const predictionContext = request.squad.playerIds
        ? await readPredictionContext(client, request.gameweekId, request.predictionRunId)
        : null;
      const squad = resolveSquad(request.squad, predictionContext?.candidates);
      const comparisonPool = predictionContext?.candidates ?? squad.slots;
      const startingXi = decorateStartingXiScores(optimizeStartingXi(squad), comparisonPool);

      res.json({
        success: true,
        data: {
          startingXi,
          predictionRunIds: predictionRunIdsFromCandidates(squad.slots),
          targetGameweekId: targetGameweekFromCandidates(squad.slots)
        }
      });
    } catch (error) {
      handleOptimizerRouteError(res, error);
    }
  });

  router.post('/transfers', async (req, res) => {
    try {
      const request = TransfersRequestSchema.parse(req.body);
      const needsPredictionContext = Boolean(request.currentSquad.playerIds || !request.availablePlayers);
      const predictionContext = needsPredictionContext
        ? await readPredictionContext(client, request.gameweekId, request.predictionRunId)
        : null;
      const currentSquad = resolveSquad(request.currentSquad, predictionContext?.candidates);
      if (currentSquad.existingSquad && (request.freeTransfers > 0 || (request.maxHits ?? 0) > 0)) {
        if (request.currentSquad.bank === undefined) throw new OptimizerRouteError(400, 'bank_required');
        if (currentSquad.slots.some(slot => slot.sellingPrice === undefined)) {
          throw new OptimizerRouteError(400, 'selling_prices_required');
        }
      }
      const availablePlayers = request.availablePlayers ?? predictionContext?.candidates;
      if (!availablePlayers) {
        throw new OptimizerRouteError(400, 'available_players_required');
      }

      const comparisonPool = uniquePlayersById([...currentSquad.slots, ...availablePlayers]);
      const currentStartingXi = decorateStartingXiScores(optimizeStartingXi(currentSquad), comparisonPool);
      const recommendations = recommendTransfers({
        currentSquad,
        availablePlayers,
        freeTransfers: request.freeTransfers,
        maxHits: request.maxHits
      }).map(recommendation => decorateTransferScores(recommendation, comparisonPool));

      res.json({
        success: true,
        data: {
          currentStartingXi,
          recommendations,
          predictionRunIds: predictionRunIdsFromCandidates([...currentSquad.slots, ...availablePlayers]),
          targetGameweekId: targetGameweekFromCandidates([...currentSquad.slots, ...availablePlayers])
        },
        count: recommendations.length
      });
    } catch (error) {
      handleOptimizerRouteError(res, error);
    }
  });

  router.post('/squad', async (req, res) => {
    try {
      const request = SquadBuildRequestSchema.parse(req.body);
      const predictionContext = request.availablePlayers
        ? null
        : await readPredictionContext(client, request.gameweekId, request.predictionRunId);
      const candidates = request.availablePlayers ?? predictionContext?.candidates;
      if (!candidates) {
        throw new OptimizerRouteError(400, 'available_players_required');
      }

      const squad = buildSquadFromCandidates({
        candidates,
        budget: request.budget,
        reservedBank: request.reservedBank
      });
      const startingXi = decorateStartingXiScores(optimizeStartingXi(squad), candidates);

      res.json({
        success: true,
        data: {
          squad,
          startingXi,
          predictionRunIds: predictionRunIdsFromCandidates(squad.slots),
          targetGameweekId: targetGameweekFromCandidates(squad.slots)
        }
      });
    } catch (error) {
      handleOptimizerRouteError(res, error);
    }
  });

  return router;
}

async function readPredictionContext(
  client: Queryable,
  gameweekId?: number,
  predictionRunId?: number
): Promise<{ candidates: PlayerCandidate[] }> {
  if (gameweekId !== undefined && predictionRunId === undefined) {
    const summary = await readGameweekPredictionSummary(client, gameweekId);
    if (!summary) throw new OptimizerRouteError(404, 'no_prediction_runs_loaded');
    return { candidates: predictionsToCandidates(summary.predictions) };
  }

  const window = await readPlanningWindow(client);
  if (!window || window.gameweek.runId === null) {
    throw new OptimizerRouteError(503, 'no_planning_predictions');
  }
  if (predictionRunId !== undefined && window.gameweek.runId !== predictionRunId) {
    throw new OptimizerRouteError(409, 'planning_gameweek_changed');
  }
  const predictions = await readPlanningPredictions(client, window);
  if (predictions.length === 0) throw new OptimizerRouteError(503, 'no_planning_predictions');
  const candidates = predictionsToCandidates(predictions);
  const blankPlayers = await readBlankGameweekCandidates(client, window.snapshotId, window.gameweek.id, window.gameweek.runId);
  return { candidates: uniquePlayersById([...candidates, ...blankPlayers]) };
}

function resolveSquad(input: SquadInput, predictionCandidates?: readonly PlayerCandidate[]): Squad {
  if (input.slots) {
    return toSquad(input.slots, input);
  }

  if (!input.playerIds) {
    throw new OptimizerRouteError(400, 'squad_players_required');
  }

  if (!predictionCandidates) {
    throw new OptimizerRouteError(400, 'prediction_candidates_required');
  }

  const candidateById = new Map(predictionCandidates.map(candidate => [candidate.playerId, candidate]));
  const missingPlayerIds = input.playerIds.filter(playerId => !candidateById.has(playerId));
  if (missingPlayerIds.length > 0) {
    throw new OptimizerRouteError(400, 'squad_predictions_missing', { playerIds: missingPlayerIds });
  }

  return toSquad(
    input.playerIds.map(playerId => candidateById.get(playerId)).filter(isPlayerCandidate),
    input
  );
}

function toSquad(players: readonly PlayerCandidate[], input: SquadInput): Squad {
  const bank = input.bank ?? 0;
  const slots = players.map((player, slotIndex) => {
    const sellingPrice = input.existingSquad ? input.sellingPrices?.[player.playerId] : undefined;
    if (sellingPrice !== undefined && sellingPrice > player.price) {
      throw new OptimizerRouteError(400, 'invalid_selling_price', { playerId: player.playerId });
    }
    return { ...player, slotIndex, sellingPrice };
  });
  return {
    budget: input.existingSquad ? roundMoney(calculateSquadCost(slots) + bank) : input.budget,
    bank,
    slots,
    existingSquad: input.existingSquad
  };
}

function uniquePlayersById<T extends PlayerCandidate>(players: readonly T[]): T[] {
  const playerById = new Map<number, T>();
  for (const player of players) {
    if (!playerById.has(player.playerId)) {
      playerById.set(player.playerId, player);
    }
  }
  return [...playerById.values()];
}

function isPlayerCandidate(value: PlayerCandidate | undefined): value is PlayerCandidate {
  return value !== undefined;
}

function predictionRunIdsFromCandidates(candidates: readonly PlayerCandidate[]): number[] {
  return uniqueSortedNumbers(candidates.map(candidate => candidate.predictionRunId));
}

function targetGameweekFromCandidates(candidates: readonly PlayerCandidate[]): number | undefined {
  return uniqueSortedNumbers(candidates.map(candidate => candidate.targetGameweekId))[0];
}

function uniqueSortedNumbers(values: ReadonlyArray<number | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => value !== undefined))]
    .sort((left, right) => left - right);
}

function handleOptimizerRouteError(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      success: false,
      error: 'invalid_optimizer_request',
      details: error.issues
    });
    return;
  }

  if (error instanceof OptimizerInputError) {
    res.status(400).json({
      success: false,
      error: error.code,
      validation: error.validation
    });
    return;
  }

  if (error instanceof OptimizerRouteError) {
    res.status(error.status).json({
      success: false,
      error: error.code,
      details: error.details
    });
    return;
  }

  if (error instanceof Error && ['invalid_squad_budget', 'squad_generation_failed'].includes(error.message)) {
    res.status(422).json({ success: false, error: error.message });
    return;
  }

  res.status(500).json({
    success: false,
    error: 'optimizer_request_failed'
  });
}

export const optimizerRouter = createOptimizerRouter();
