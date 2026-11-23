# Deploy ScoutIQ

The rehearsed deployment uses one Node service to serve the Vite build and Express API on the same HTTPS origin. PostgreSQL stores the current FPL snapshot and projections. Run refresh jobs separately from web requests. Databricks is an independent analytics path documented in [Databricks](DATABRICKS.md).

See [Production readiness](PRODUCTION_READINESS.md) for the release decision and test evidence.

## Provision staging

1. Choose a Node host and a PostgreSQL 16 service. The local rehearsal used Node 22.19.0, pnpm 10.15.1, Python 3.13.7 and PostgreSQL 16. Use the same versions for the first staging run. The batch runner needs Python and the workspace dependencies used by the TypeScript CLI commands.
2. Set `DATABASE_URL` through the host's secret manager. Require verified TLS for a managed database. Set `DATABASE_SSL=true` or use the provider's verified TLS connection string. Supply the provider's CA using `NODE_EXTRA_CA_CERTS` if required. See [Environment](ENVIRONMENT.md).
3. Configure the web service with `NODE_ENV=production`, the host-assigned `PORT`, and `SCOUTIQ_DATA_MODE=fpl`. Leave `SCOUTIQ_AGENT_ENABLED=false` to start with deterministic explanations.
4. Route HTTPS traffic to that service. If a proxy forwards client addresses, set `SCOUTIQ_TRUST_PROXY` only to its verified IPs or CIDRs and ensure the proxy replaces untrusted forwarding headers. A reverse proxy on the same machine can use `loopback`. Verify the address configuration in staging so unrelated managers receive separate rate limits.
5. From the repository root, install, build, migrate and load data. Set the same database credentials on the batch runner.

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run db:migrate
pnpm run refresh:fpl --fetch-history
NODE_ENV=production SCOUTIQ_DATA_MODE=fpl pnpm --filter @fpl-optimizer/api run start
```

Set the build command to `pnpm install --frozen-lockfile && pnpm run build` and the start command to `pnpm --filter @fpl-optimizer/api run start` in the hosting platform. Retain both workspaces in the build. Express serves `apps/web/dist`, preserves SPA deep links and serves API paths separately. Keep `VITE_API_BASE_URL=/api` for this path.

For separate hosts, configure an `/api/*` reverse proxy on the frontend or set `VITE_API_BASE_URL` to the public API URL including `/api` at web build time. Set the API's `FRONTEND_URL` to the exact browser origin and configure the static host's history fallback after its asset routes. Verify the frontend and API URLs separately. The Vercel-specific manifests have not been exercised on a hosted project.

## Refresh data

`pnpm run refresh:fpl --fetch-history` captures public player, fixture and history data with four concurrent history requests, trains or evaluates when enough completed gameweeks are available, then publishes the matching FPL and projection rows in one database transaction. History remains optional early in the season. With fewer than two completed gameweeks, projections come from the prior-season fit alone. Backtests start after three. A failed publish leaves the previous snapshot in place. The publisher rejects older snapshots, mismatched input hashes, incomplete fixture coverage and targets whose deadlines have passed.

Set a scheduler on the batch runner. Refresh at least daily during the season and around deadlines so the next game's projections are loaded promptly. Set the scheduler to serialize runs, capture the exit status and alert on failures or stale data. For frequent schedule and price refreshes, reuse a same-season local history file that your history job refreshes separately.

```sh
pnpm run ingest:fpl
pnpm run ingest:fpl:history --concurrency 4
pnpm run refresh:fpl --snapshot data/fpl/latest --history data/fpl/history/player_gameweek_history.json
# Later, refresh only bootstrap and fixtures and reuse the history file.
pnpm run refresh:fpl --history data/fpl/history/player_gameweek_history.json
```

The browser chooses the earliest unfinished gameweek with an open deadline. It serves the matching projection run from the same source snapshot. When no run matches, player lookup and saved squads remain available. The model page displays historical backtests with their evaluation scope and timestamps.

## Verify before public traffic

Run the release smoke check against the staging URL. For the one-service deployment, use the same URL twice.

```sh
SCOUTIQ_API_URL=https://staging.example.com \
SCOUTIQ_WEB_URL=https://staging.example.com \
SCOUTIQ_SMOKE_REQUIRE_READY=1 pnpm run smoke:app
```

- `/api/health` checks process liveness. Use it for the platform's restart probe.
- `/api/ready` returns 200 for a matching FPL projection run less than 48 hours old. It returns 503 for a missing run, a stale snapshot, sample mode or unavailable PostgreSQL. Monitor it separately to distinguish a data-refresh issue from a process crash.
- Verify HTTPS and a hard refresh on `/squad`, `/analyze`, `/top-players`, a player detail route and `/evaluation`. Check draft generation, an owned squad, a transfer with an entered selling price, and the deterministic explanation.
- Test one consented public FPL entry on the deployed host. Confirm that the preview refers to the most recent published deadline and lets you edit picks and confirm finances. Check the host can reach the FPL endpoints and respects upstream limits.
- Verify the scheduled refresh completes in the hosting environment and the readiness response advances to the next deadline. Once those checks pass, point the public domain to the service and rerun the smoke test against it.

If a code release fails, redeploy the last known working build and rerun the smoke check. For a failed refresh, inspect the batch exit and retry with a fresh official snapshot. If data is corrupt, restore a database backup into a separate instance and verify readiness and the browser journey before switching connections.

## Reproduce offline with synthetic data

Use a disposable database with no user data. With Docker Compose and the local defaults, start PostgreSQL and use a port that is free. When changing `POSTGRES_PORT`, remove any local `DATABASE_URL` override or update its port.

```sh
export POSTGRES_PORT=55432
docker compose up -d --wait postgres
pnpm install --frozen-lockfile
pnpm run db:migrate
fixture_dir=$(mktemp -d)
node scripts/prepare-browser-fixture.mjs "$fixture_dir"
pnpm run refresh:fpl --snapshot "$fixture_dir"
pnpm run build
NODE_ENV=production SCOUTIQ_DATA_MODE=sample pnpm --filter @fpl-optimizer/api run start
```

In another terminal, run the test with the built app's URL.

```sh
pnpm exec playwright install chromium
SCOUTIQ_WEB_URL=http://localhost:3001 SCOUTIQ_BROWSER_FIXTURE=1 pnpm run test:browser
POSTGRES_PORT=55432 SCOUTIQ_BROWSER_FIXTURE=1 pnpm run test:planning-db
SCOUTIQ_API_URL=http://localhost:3001 SCOUTIQ_WEB_URL=http://localhost:3001 pnpm run smoke:app
```

Set `SCOUTIQ_BROWSER_CHANNEL=chrome` if using an existing Google Chrome installation. Sample mode supports the local planner with an explicit banner. Its release readiness stays 503 and public entry lookups are disabled. The browser suite uses local responses to test the import UI.
