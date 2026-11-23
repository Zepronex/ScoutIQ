import axios from 'axios';
import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { getServerPool, Queryable } from '../db/client';
import { readSquadBuilderPlayers } from '../db/playerQueries';
import { createTtlCache } from '../lib/guards';
import { EnrichedPlayer, Squad } from '../types';

const entryRequest = z.object({ entryId: z.number().int().min(1).max(2_147_483_647) }).strict();
const picksResponse = z.object({
  picks: z.array(z.object({
    element: z.number().int().positive(),
    position: z.number().int().min(1).max(15)
  })).length(15)
});

const PICKS_CACHE_MS = 10 * 60 * 1000;

type EntryProvider = (entryId: number, gameweekId: number) => Promise<unknown>;

class EntryImportError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function createEntriesRouter(client: Queryable = getServerPool(), readPicks: EntryProvider = readPublicPicks): ExpressRouter {
  const router: ExpressRouter = Router();
  // Public picks are fixed once a deadline passes. Remember recent lookups so
  // repeated imports of the same team do not reach the FPL servers again.
  const picksCache = createTtlCache<unknown>(PICKS_CACHE_MS, 500);
  router.post('/import', async (req, res) => {
    const parsed = entryRequest.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Enter a valid numeric FPL team ID.' });
    if (process.env.SCOUTIQ_DATA_MODE === 'sample') {
      return res.status(503).json({ success: false, error: 'Public team import is unavailable in sample mode.' });
    }

    try {
      const { rows: [gameweek] } = await client.query<{ id: number; season: string | null; snapshot_id: string }>(`
        WITH snapshot AS (
          SELECT id, season, generated_at FROM ingestion_runs ORDER BY generated_at DESC, id DESC LIMIT 1
        )
        SELECT g.id, s.season, s.id AS snapshot_id
        FROM snapshot s JOIN gameweeks g ON g.ingestion_run_id = s.id
        WHERE s.generated_at > now() - interval '7 days'
          AND g.deadline_time <= now() AND g.deadline_time > now() - interval '30 days'
        ORDER BY g.deadline_time DESC LIMIT 1
      `);
      if (!gameweek) throw new EntryImportError(409, 'There is no recent FPL deadline to import. You can add players manually.');

      const received = await picksCache.get(
        `${gameweek.snapshot_id}:${gameweek.id}:${parsed.data.entryId}`,
        () => readPicks(parsed.data.entryId, gameweek.id)
      );
      const picks = picksResponse.safeParse(received);
      if (!picks.success ||
        new Set(picks.data.picks.map(pick => pick.element)).size !== 15 ||
        new Set(picks.data.picks.map(pick => pick.position)).size !== 15) {
        throw new EntryImportError(409, 'FPL did not return all 15 picks. Try again later or add your players manually.');
      }

      const catalog = await readSquadBuilderPlayers(client, Number(gameweek.snapshot_id));
      const byId = new Map(catalog.map(player => [player.id, player]));
      const players = [...picks.data.picks].sort((a, b) => a.position - b.position)
        .map(pick => byId.get(pick.element)).filter((player): player is EnrichedPlayer => Boolean(player));
      if (players.length !== 15) {
        throw new EntryImportError(409, 'Some picks are missing from the current FPL player list. Add your squad manually.');
      }

      const squad: Squad = {
        startingXI: players.slice(0, 11),
        bench: players.slice(11),
        mode: 'existing',
        bank: 0
      };
      res.json({ success: true, data: { squad, gameweekId: gameweek.id, season: gameweek.season } });
    } catch (error) {
      const known = error instanceof EntryImportError;
      res.status(known ? error.status : 503).json({
        success: false,
        error: known ? error.message : 'Public FPL picks are temporarily unavailable. Try again or add players manually.'
      });
    }
  });
  return router;
}

const publicFpl = axios.create({
  baseURL: 'https://fantasy.premierleague.com/api/',
  timeout: 4000,
  maxRedirects: 0,
  maxContentLength: 64 * 1024,
  validateStatus: () => true
});

export async function readPublicPicks(entryId: number, gameweekId: number, provider = publicFpl): Promise<unknown> {
  const response = await provider.get(`entry/${entryId}/event/${gameweekId}/picks/`);
  if (response.status === 200) return response.data;
  if (response.status === 404) {
    const entry = await provider.get(`entry/${entryId}/`);
    if (entry.status === 404) throw new EntryImportError(404, 'That FPL team ID was not found. Check the number in your FPL Points page address.');
    if (entry.status === 200) throw new EntryImportError(409, 'This team has no public picks for the latest deadline yet.');
  }
  if (response.status === 403) throw new EntryImportError(409, 'FPL has not made these picks public. You can add your players manually.');
  throw new EntryImportError(503, 'Public FPL picks are temporarily unavailable. Try again or add players manually.');
}

export const entriesRouter = createEntriesRouter();
