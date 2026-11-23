import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { getServerPool } from './db/client';
import { readLimit } from './lib/guards';
import { readPlanningWindow } from './db/predictionQueries';
import { playersRouter } from './routes/players';
import { analyzeRouter } from './routes/analyze';
import { predictionsRouter } from './routes/predictions';
import { modelRouter } from './routes/model';
import { evaluationRouter } from './routes/evaluation';
import { optimizerRouter } from './routes/optimizer';
import { agentRouter } from './routes/agent';
import { healthRouter } from './routes/health';
import { entriesRouter } from './routes/entries';

export function createApp(): express.Express {
  const app = express();
  const windowMs = 15 * 60 * 1000;
  const limitedResponse = { success: false, error: 'Too many requests. Try again when the rate limit resets.' };
  const trustedProxies = readTrustedProxies(process.env.SCOUTIQ_TRUST_PROXY);
  if (trustedProxies.length) app.set('trust proxy', trustedProxies);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"]
      }
    }
  }));

  // The planning payload is about 170 KB of JSON and compresses to roughly a tenth.
  app.use(compression());

  app.use('/api', cors({
    origin: readFrontendOrigin(process.env.FRONTEND_URL),
    // The API has no cookies or sessions, so it never needs credentialed requests.
    credentials: false,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['Retry-After']
  }));
  app.use('/api/health', healthRouter);
  app.get('/api/ready', rateLimit({
    windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: limitedResponse
  }), async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const window = await readPlanningWindow(getServerPool());
      const status = process.env.SCOUTIQ_DATA_MODE === 'sample' ? 'sample_data'
        : !window?.gameweek.runId ? 'waiting_for_projections'
        : Date.now() - Date.parse(window.gameweek.sourceUpdatedAt) > 48 * 60 * 60 * 1000 ? 'stale_snapshot'
        : 'ready';
      return res.status(status === 'ready' ? 200 : 503).json({
        status,
        gameweek: window?.gameweek ?? null
      });
    } catch {
      return res.status(503).json({ status: 'database_unavailable' });
    }
  });

  app.use('/api', rateLimit({ windowMs, limit: 100, standardHeaders: true, legacyHeaders: false, message: limitedResponse }));
  app.use('/api', slowDown({ windowMs, delayAfter: 50, delayMs: () => 500, maxDelayMs: 20000 }));

  const limitPlanning = (limit = 10) => rateLimit({
    windowMs, limit, standardHeaders: true, legacyHeaders: false,
    skip: req => req.method !== 'POST',
    message: limitedResponse
  });
  // Per-address limits do not stop a crowd of addresses. These ceilings count
  // every caller together so total CPU and upstream FPL traffic stay bounded.
  const limitEveryone = (limit: number) => rateLimit({
    windowMs, limit, standardHeaders: false, legacyHeaders: false,
    keyGenerator: () => 'everyone',
    skip: req => req.method !== 'POST',
    statusCode: 503,
    message: { success: false, error: 'ScoutIQ is busy right now. Try again in a few minutes.' }
  });
  const planningCeiling = limitEveryone(readLimit(process.env.SCOUTIQ_GLOBAL_PLANNING_LIMIT, 900, 'SCOUTIQ_GLOBAL_PLANNING_LIMIT'));
  const importCeiling = limitEveryone(readLimit(process.env.SCOUTIQ_GLOBAL_IMPORT_LIMIT, 150, 'SCOUTIQ_GLOBAL_IMPORT_LIMIT'));
  app.use('/api/analyze', limitPlanning(30), planningCeiling);
  app.use('/api/optimizer/squad', limitPlanning(), planningCeiling);
  app.use('/api/optimizer/transfers', limitPlanning(), planningCeiling);
  app.use('/api/optimizer/starting-xi', limitPlanning(30), planningCeiling);
  app.use('/api/agent', limitPlanning(), planningCeiling);
  app.use('/api/entries', limitPlanning(), importCeiling);
  app.use('/api', express.json({ limit: '512kb' }));
  app.use('/api', express.urlencoded({ extended: false, limit: '64kb' }));

  app.use('/api/players', playersRouter);
  app.use('/api/analyze', analyzeRouter);
  app.use('/api/predictions', predictionsRouter);
  app.use('/api/model', modelRouter);
  app.use('/api/evaluation', evaluationRouter);
  app.use('/api/optimizer', optimizerRouter);
  app.use('/api/agent', agentRouter);
  app.use('/api/entries', entriesRouter);
  app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Endpoint not found' }));

  const webDist = path.resolve(__dirname, '../../web/dist');
  const index = path.join(webDist, 'index.html');
  if (existsSync(index)) {
    app.use('/assets', express.static(path.join(webDist, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(webDist, { index: false }));
    app.get('*', (req, res, next) => {
      if (!req.accepts('html') || req.path.startsWith('/assets/') || path.extname(req.path)) return next();
      res.set('Cache-Control', 'no-cache');
      return res.sendFile(index);
    });
  }

  app.use((err: { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ success: false, error: 'Request is too large.' });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, error: 'Invalid JSON.' });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  });
  return app;
}

function readFrontendOrigin(value: string | undefined): string {
  const origin = value || 'http://localhost:3000';
  try {
    const url = new URL(origin);
    if (url.origin === origin && ['http:', 'https:'].includes(url.protocol)) return url.origin;
  } catch {
    // Use a configuration error that omits the supplied value.
  }
  throw new Error('FRONTEND_URL must be an HTTP or HTTPS origin with no path or trailing slash.');
}

function readTrustedProxies(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map(proxy => {
    const entry = proxy.trim();
    if (entry === 'loopback') return entry;
    const [address, bits, ...rest] = entry.split('/');
    const family = isIP(address);
    if (!rest.length && family && (bits === undefined ||
      (/^\d+$/.test(bits) && Number(bits) > 0 && Number(bits) <= (family === 4 ? 32 : 128)))) return entry;
    throw new Error('SCOUTIQ_TRUST_PROXY must contain trusted IPs, CIDRs or loopback.');
  });
}

const app = createApp();
export default app;

if (require.main === module) {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const mode = process.env.SCOUTIQ_DATA_MODE;
  if (mode && mode !== 'sample' && mode !== 'fpl') throw new Error('SCOUTIQ_DATA_MODE must be fpl or sample.');
  const server = app.listen(port, () => console.log(`ScoutIQ listening on port ${port}`));
  // Close slow or idle connections so they cannot hold sockets open indefinitely.
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 65_000;

  // Hosts send SIGTERM on every deploy and restart. Finish open requests first.
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(() => {
      void getServerPool().end().catch(() => undefined).then(() => process.exit(0));
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
