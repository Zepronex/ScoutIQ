import { Router, Response, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { getServerPool, Queryable } from '../db/client';
import { createTtlCache } from '../lib/guards';
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

const PLANNING_CACHE_MS = 10_000;

export function createPredictionsRouter(client: Queryable = getServerPool()): ExpressRouter {
  const router: ExpressRouter = Router();

  // The planning payload is identical for every visitor between refreshes.
  // It stays short-lived so a passed deadline is reflected within seconds.
  const planningCache = createTtlCache<unknown>(PLANNING_CACHE_MS);
  const readPlanning = async () => {
    const window = await readPlanningWindow(client);
    const predictions = window ? await readPlanningPredictions(client, window) : [];
    const players = predictionsToCandidates(predictions);
    if (window && window.gameweek.runId !== null && players.length) {
      const projectedIds = new Set(players.map(player => player.playerId));
      const blanks = await readBlankGameweekCandidates(client, window.snapshotId, window.gameweek.id, window.gameweek.runId);
      players.push(...blanks.filter(player => !projectedIds.has(player.playerId)));
    }
    const opponents = window ? await readOpponentLabels(client, window.snapshotId, window.gameweek.id) : new Map();
    for (const player of players) player.opponents = opponents.get(player.teamId) ?? [];
    return {
      source: process.env.SCOUTIQ_DATA_MODE === 'sample' ? 'sample' : 'fpl',
      gameweek: window ? { ...window.gameweek, runId: players.length ? window.gameweek.runId : null } : null,
      missingPlayerCount: window ? Math.max(0, window.playerCount - players.length) : 0,
      players
    };
  };

  router.get('/planning', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json({ success: true, data: await planningCache.get('planning', readPlanning) });
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

/** Maps each club to its fixtures in the gameweek, such as "ARS (A)". */
async function readOpponentLabels(client: Queryable, snapshotId: number, gameweekId: number): Promise<Map<number, string[]>> {
  const { rows } = await client.query<{ team_h_id: number; team_a_id: number; home: string; away: string }>(`
    SELECT f.team_h_id, f.team_a_id, h.short_name AS home, a.short_name AS away
    FROM fixtures f
    JOIN teams h ON h.id = f.team_h_id
    JOIN teams a ON a.id = f.team_a_id
    WHERE f.ingestion_run_id = $1 AND f.event_id = $2 AND NOT f.started AND NOT f.finished
    ORDER BY f.kickoff_time NULLS LAST, f.id
  `, [snapshotId, gameweekId]);
  const labels = new Map<number, string[]>();
  for (const row of rows) {
    if (!row.home || !row.away) continue;
    labels.set(row.team_h_id, [...(labels.get(row.team_h_id) ?? []), `${row.away} (H)`]);
    labels.set(row.team_a_id, [...(labels.get(row.team_a_id) ?? []), `${row.home} (A)`]);
  }
  return labels;
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
