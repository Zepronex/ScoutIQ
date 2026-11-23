import { Router, Response, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { getServerPool, Queryable } from '../db/client';
import { createTtlCache } from '../lib/guards';
import {
  readEvaluationDataCoverage,
  readLatestModelEvaluation,
  readLatestPredictionRun,
  readModelEvaluationRuns
} from '../db/predictionQueries';
import {
  buildEvaluationDataHealth,
  buildEvaluationLatest,
  buildEvaluationRuns,
  readPlayerGameweekHistoryArtifact
} from '../evaluation/dashboard';

type EvaluationRouterOptions = {
  playerGameweekHistoryPath?: string;
  now?: () => Date;
  cacheMs?: number;
};

const runsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25)
});

export function createEvaluationRouter(
  client: Queryable = getServerPool(),
  options: EvaluationRouterOptions = {}
): ExpressRouter {
  const router: ExpressRouter = Router();
  // The history file is a local pipeline artifact. A deployed service has no
  // copy, and parsing tens of megabytes per request would stall every other
  // caller, so it is only read when a path is passed in explicitly.
  const historyPath = options.playerGameweekHistoryPath;
  const cache = createTtlCache<unknown>(options.cacheMs ?? 30_000);

  router.get('/latest', async (_req, res) => {
    try {
      const data = await cache.get('latest', async () => {
        const [evaluation, latestPredictionRun] = await Promise.all([
          readLatestModelEvaluation(client),
          readLatestPredictionRun(client)
        ]);
        return buildEvaluationLatest({ evaluation, latestPredictionRun });
      });

      res.json({ success: true, data });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  router.get('/runs', async (req, res) => {
    try {
      const query = runsQuerySchema.parse(req.query);
      const data = await cache.get(`runs:${query.limit}`, async () =>
        buildEvaluationRuns(await readModelEvaluationRuns(client, { limit: query.limit }))) as ReturnType<typeof buildEvaluationRuns>;

      res.json({
        success: true,
        data,
        count: data.count
      });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  router.get('/data-health', async (_req, res) => {
    try {
      const data = await cache.get('data-health', async () => {
        const [coverage, latestPredictionRun, historyArtifact] = await Promise.all([
          readEvaluationDataCoverage(client),
          readLatestPredictionRun(client),
          historyPath ? readPlayerGameweekHistoryArtifact(historyPath) : { artifact: null, warnings: [] }
        ]);
        return buildEvaluationDataHealth({ coverage, latestPredictionRun, historyArtifact, now: options.now?.() });
      });

      res.json({ success: true, data });
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
      error: 'invalid_evaluation_request',
      details: error.issues
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: 'Failed to fetch evaluation data'
  });
}

export const evaluationRouter = createEvaluationRouter();
