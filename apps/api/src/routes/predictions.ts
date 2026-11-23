import { Router, Response, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { getServerPool, Queryable } from '../db/client';
import {
  readGameweekPredictionSummary,
  readLatestPredictionSummary,
  readPlanningPredictions,
  readPlanningWindow,
  readPlayerPredictions,
  readTopPredictions
} from '../db/predictionQueries';
import { PLAYER_CANDIDATE_REQUIRED_COMMANDS, readBlankGameweekCandidates } from '../db/playerQueries';
import { predictionsToCandidates } from '../optimizer/predictionAdapter';

const PositionSchema = z.enum(['GK', 'DEF', 'MID', 'FWD']);
const PositiveIdSchema = z.coerce.number().int().positive().max(2_147_483_647);

const topPredictionsQuerySchema = z.object({
  gameweekId: PositiveIdSchema.optional(),
  position: PositionSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25)
});

export function createPredictionsRouter(client: Queryable = getServerPool()): ExpressRouter {
  const router: ExpressRouter = Router();

  router.get('/planning', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const window = await readPlanningWindow(client);
      const predictions = window ? await readPlanningPredictions(client, window) : [];
      const players = predictionsToCandidates(predictions);
      if (window && window.gameweek.runId !== null && players.length) {
        const projectedIds = new Set(players.map(player => player.playerId));
        const blanks = await readBlankGameweekCandidates(client, window.snapshotId, window.gameweek.id, window.gameweek.runId);
        players.push(...blanks.filter(player => !projectedIds.has(player.playerId)));
      }
      res.json({
        success: true,
        data: {
          source: process.env.SCOUTIQ_DATA_MODE === 'sample' ? 'sample' : 'fpl',
          gameweek: window ? { ...window.gameweek, runId: players.length ? window.gameweek.runId : null } : null,
          missingPlayerCount: window ? Math.max(0, window.playerCount - players.length) : 0,
          players
        }
      });
    } catch {
      res.status(503).json({ success: false, error: 'Could not load the FPL schedule. Try again shortly.' });
    }
  });

  router.get('/latest', async (_req, res) => {
    try {
      const summary = await readLatestPredictionSummary(client);
      if (!summary) {
        return res.status(404).json({
          success: false,
          error: 'No prediction runs loaded',
          requiredCommands: PLAYER_CANDIDATE_REQUIRED_COMMANDS
        });
      }

      res.json({
        success: true,
        data: summary,
        count: summary.count
      });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  router.get('/player/:playerId', async (req, res) => {
    try {
      const playerId = PositiveIdSchema.parse(req.params.playerId);
      const predictions = await readPlayerPredictions(client, playerId);
      if (predictions.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No predictions found for player'
        });
      }

      res.json({
        success: true,
        data: {
          playerId,
          predictions,
          count: predictions.length
        },
        count: predictions.length
      });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  router.get('/gameweek/:gameweekId', async (req, res) => {
    try {
      const gameweekId = PositiveIdSchema.parse(req.params.gameweekId);
      const summary = await readGameweekPredictionSummary(client, gameweekId);
      if (!summary) {
        return res.status(404).json({
          success: false,
          error: 'No prediction run loaded for gameweek',
          requiredCommands: PLAYER_CANDIDATE_REQUIRED_COMMANDS
        });
      }

      res.json({
        success: true,
        data: summary,
        count: summary.count
      });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  router.get('/top', async (req, res) => {
    try {
      const filters = topPredictionsQuerySchema.parse(req.query);
      const summary = await readTopPredictions(client, filters);
      if (!summary) {
        return res.status(404).json({
          success: false,
          error: 'No prediction runs loaded',
          requiredCommands: PLAYER_CANDIDATE_REQUIRED_COMMANDS
        });
      }

      res.json({
        success: true,
        data: summary,
        count: summary.count
      });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  return router;
}

function handleRouteError(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      success: false,
      error: 'Invalid prediction request',
      details: error.issues
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: 'Failed to fetch prediction data'
  });
}

export const predictionsRouter = createPredictionsRouter();
