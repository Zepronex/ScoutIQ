import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { SquadAnalyzer } from '../lib/squad';
import { ScoringService } from '../lib/scoring';
import { AnalysisWeights, EnrichedPlayer, Squad, SquadSlot } from '../types';
import { getServerPool, Queryable } from '../db/client';
import {
  PLAYER_CANDIDATE_REQUIRED_COMMANDS,
  readSquadBuilderPlayers
} from '../db/playerQueries';

// Validation schemas
const squadSlotSchema = z.object({
  id: z.number().int().positive(),
  code: z.number().int().positive().nullable().optional(),
  name: z.string().optional(),
  pos: z.enum(['GK', 'DEF', 'MID', 'FWD']),
  price: z.number().finite().nonnegative(),
  teamId: z.number().int().positive().optional(),
  sellingPrice: z.number().finite().positive().optional()
});

const squadSchema = z.object({
  startingXI: z.array(squadSlotSchema).length(11),
  bench: z.array(squadSlotSchema).length(4),
  bank: z.number().finite().min(0).max(100),
  mode: z.enum(['draft', 'existing']).optional()
});

const weightsSchema = z.object({
  form: z.number().min(0).max(1).optional(),
  xg90: z.number().min(0).max(1).optional(),
  xa90: z.number().min(0).max(1).optional(),
  expMin: z.number().min(0).max(1).optional(),
  next3Ease: z.number().min(0).max(1).optional(),
  avgPoints: z.number().min(0).max(1).optional(),
  value: z.number().min(0).max(1).optional(),
  ownership: z.number().min(0).max(1).optional()
});

const analyzeRequestSchema = z.object({
  squad: squadSchema,
  weights: weightsSchema.optional(),
  verifySavedNames: z.boolean().optional()
});

export function createAnalyzeRouter(client: Queryable = getServerPool()): ExpressRouter {
  const router: ExpressRouter = Router();

  // POST /api/analyze - Analyze squad and get suggestions
  router.post('/', async (req, res) => {
    try {
      const { squad, weights, verifySavedNames } = analyzeRequestSchema.parse(req.body);
      const playerPool = await readSquadBuilderPlayers(client);

      if (playerPool.length === 0) {
        return res.status(503).json({
          success: false,
          error: 'The current FPL player list is unavailable.',
          requiredCommands: PLAYER_CANDIDATE_REQUIRED_COMMANDS
        });
      }

      const enrichedSquad = enrichSquadFromPlayerPool(squad, playerPool);
      const unknownPlayerIds = getUnknownPlayerIds(squad, playerPool, verifySavedNames);

      if (unknownPlayerIds.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Some saved players are missing from the current FPL player list. Edit your squad and replace those players.',
          details: { playerIds: unknownPlayerIds },
          requiredCommands: PLAYER_CANDIDATE_REQUIRED_COMMANDS
        });
      }

      // Validate squad formation and constraints after enrichment from authoritative local data.
      const validation = SquadAnalyzer.validateSquad(enrichedSquad);
      const unavailable = unavailableDraftPlayers(squad, playerPool);
      if (unavailable.length) {
        return res.status(400).json({
          success: false,
          error: 'Replace unavailable players before using this squad as a new draft.',
          details: { playerIds: unavailable }
        });
      }
      if (!validation.valid) {
        const errors = validation.errors.length > 0
          ? validation.errors
          : ['Invalid squad configuration.'];

        return res.status(400).json({
          success: false,
          error: errors[0],
          details: errors
        });
      }

      const analysisWeights = normalizeWeights({
        form: weights?.form ?? 0.2,
        xg90: weights?.xg90 ?? 0.15,
        xa90: weights?.xa90 ?? 0.15,
        expMin: weights?.expMin ?? 0.15,
        next3Ease: weights?.next3Ease ?? 0.1,
        avgPoints: weights?.avgPoints ?? 0.15,
        value: weights?.value ?? 0.05,
        ownership: weights?.ownership ?? 0.05
      });

      const analysis = await SquadAnalyzer.analyzeSquad(enrichedSquad, analysisWeights, playerPool);

      res.json({
        success: true,
        data: {
          ...analysis,
          weights: analysisWeights,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.issues
        });
      }

      res.status(503).json({
        success: false,
        error: 'Could not load squad analysis. Try again shortly.',
        requiredCommands: PLAYER_CANDIDATE_REQUIRED_COMMANDS
      });
    }
  });

  // POST /api/analyze/validate - Validate squad without analysis
  router.post('/validate', async (req, res) => {
    try {
      const { squad } = z.object({ squad: squadSchema }).parse(req.body);
      const playerPool = await readSquadBuilderPlayers(client);

      if (playerPool.length === 0) {
        return res.status(503).json({
          success: false,
          error: 'The current FPL player list is unavailable.',
          requiredCommands: PLAYER_CANDIDATE_REQUIRED_COMMANDS
        });
      }

      const unknownPlayerIds = getUnknownPlayerIds(squad, playerPool);
      if (unknownPlayerIds.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Some saved players are missing from the current FPL player list. Edit your squad and replace those players.',
          details: { playerIds: unknownPlayerIds },
          requiredCommands: PLAYER_CANDIDATE_REQUIRED_COMMANDS
        });
      }

      const enrichedSquad = enrichSquadFromPlayerPool(squad, playerPool);
      const validation = SquadAnalyzer.validateSquad(enrichedSquad);
      const unavailable = unavailableDraftPlayers(squad, playerPool);

      res.json({
        success: true,
        data: {
          valid: validation.valid && unavailable.length === 0,
          errors: unavailable.length
            ? [...validation.errors, 'Replace unavailable players before using this squad as a new draft.']
            : validation.errors
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.issues
        });
      }

      res.status(503).json({
        success: false,
        error: 'Could not validate the squad. Try again shortly.',
        requiredCommands: PLAYER_CANDIDATE_REQUIRED_COMMANDS
      });
    }
  });

  // GET /api/analyze/weights - Get default weights
  router.get('/weights', (_req, res) => {
    res.json({
      success: true,
      data: {
        form: 0.2,
        xg90: 0.15,
        xa90: 0.15,
        expMin: 0.15,
        next3Ease: 0.1,
        avgPoints: 0.15,
        value: 0.05,
        ownership: 0.05
      }
    });
  });

  // GET /api/analyze/presets - Get weight presets
  router.get('/presets', (_req, res) => {
    res.json({
      success: true,
      data: ScoringService.getWeightPresets()
    });
  });

  return router;
}

function enrichSquadFromPlayerPool(squad: Squad, playerPool: EnrichedPlayer[]): Squad {
  const playerMap = new Map(playerPool.map(player => [player.id, player]));
  const startingXI = squad.startingXI.map(slot => enrichSlot(slot, playerMap));
  const bench = squad.bench.map(slot => enrichSlot(slot, playerMap));
  const bank = squad.mode === 'existing' ? squad.bank
    : roundMoney(100 - calculateSquadCost([...startingXI, ...bench]));

  return {
    ...squad,
    startingXI,
    bench,
    bank
  };
}

function enrichSlot(slot: SquadSlot, playerMap: Map<number, EnrichedPlayer>): SquadSlot {
  const player = playerMap.get(slot.id);
  if (!player) return slot;

  return {
    ...slot,
    id: player.id,
    code: player.code,
    pos: player.pos,
    price: player.price,
    name: player.name,
    teamShort: player.teamShort,
    teamId: player.teamId
  };
}

function getUnknownPlayerIds(squad: Squad, playerPool: EnrichedPlayer[], verifySavedNames = false): number[] {
  const playerById = new Map(playerPool.map(player => [player.id, player]));
  const missingPlayers = [...squad.startingXI, ...squad.bench].filter(slot => {
    const player = playerById.get(slot.id);
    return !player || (slot.code != null && slot.code !== player.code) ||
      (verifySavedNames && slot.code == null && slot.name !== undefined && slot.name !== player.name);
  });

  return [...new Set(missingPlayers.map(slot => slot.id))]
    .sort((left, right) => left - right);
}

function unavailableDraftPlayers(squad: Squad, pool: EnrichedPlayer[]): number[] {
  if (squad.mode === 'existing') return [];
  const selected = new Set([...squad.startingXI, ...squad.bench].map(slot => slot.id));
  return pool.filter(player => selected.has(player.id) && player.status === 'u').map(player => player.id);
}

function normalizeWeights(weights: AnalysisWeights): AnalysisWeights {
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return weights;

  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, value / totalWeight])
  ) as AnalysisWeights;
}

function calculateSquadCost(slots: readonly SquadSlot[]): number {
  return slots.reduce((sum, slot) => sum + slot.price, 0);
}

function roundMoney(value: number): number {
  return Math.round(value * 10) / 10;
}

export const analyzeRouter = createAnalyzeRouter();

