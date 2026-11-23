# Deploy ScoutIQ

ScoutIQ runs as one container that serves the web app and the API on the same origin, plus a PostgreSQL 16 database. A scheduled GitHub Actions workflow refreshes the data. See [Running costs](COSTS.md) for prices and the spending safeguards.

```text
Browser ──HTTPS──> (Cloudflare, optional) ──> ScoutIQ container ──> PostgreSQL
                                                                      ▲
GitHub Actions, four times a day: FPL data → projections ─────────────┘
```

## 1. Create the database and service

These steps use Railway because its bill can be hard-capped. Any host that builds a Dockerfile works the same way.

1. Create a project, add a **PostgreSQL** service, then add a service from this GitHub repository. The platform builds the root `Dockerfile`.
2. Set the service variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | The database's connection string. Use the private one for the web service. |
   | `FRONTEND_URL` | The public origin, for example `https://scoutiq.example.com`. No path or trailing slash. |
   | `SCOUTIQ_TRUST_PROXY` | `1`, or `2` with Cloudflare in front |
   | `SCOUTIQ_APP_VERSION` | Optional label shown by `/api/health` |

   `NODE_ENV=production`, `PORT=3001` and `SCOUTIQ_DATA_MODE=fpl` are already set in the image. If the host assigns its own `PORT`, the server uses it.
3. Set the health check path to `/api/health` and keep the service at **one instance**.
4. Set a **hard usage limit** in the workspace settings.
5. Add your domain. For Cloudflare, proxy the DNS record and use Full (strict) TLS.

The container applies database migrations each time it starts, then starts the server.

## 2. Schedule the data refresh

`.github/workflows/refresh.yml` runs at 05:10, 11:10, 17:10 and 23:10 UTC. Each run captures the public FPL data, fits the model, backtests it and publishes players and projections in one transaction. A failed run leaves the previous data in place.

1. In the repository, add an Actions secret named `DATABASE_URL` with the database's **public** connection string.
2. If the provider's certificate is not publicly trusted, add a repository variable `DATABASE_SSL` set to `false` only as a last resort. Prefer supplying the CA through `NODE_EXTRA_CA_CERTS`.
3. Run the workflow once from the Actions tab. Until the secret exists every run is skipped.

Scheduled workflows only run from the default branch, and GitHub pauses them after 60 days without repository activity.

To refresh from your own machine instead:

```sh
DATABASE_URL=postgresql://... DATABASE_SSL=true pnpm run refresh:fpl --fetch-history
```

## 3. Verify before sharing the link

```sh
SCOUTIQ_API_URL=https://scoutiq.example.com \
SCOUTIQ_WEB_URL=https://scoutiq.example.com \
SCOUTIQ_SMOKE_REQUIRE_READY=1 pnpm run smoke:app
```

- `/api/health` reports that the process is up. Use it for the host's restart probe.
- `/api/ready` returns 200 only when projections for the next deadline exist and the snapshot is under 48 hours old. Point an uptime monitor at it to catch a refresh that has stopped.
- Open `/squad`, generate a draft, open the gameweek plan and compare a transfer.
- Import one public FPL team by its ID to confirm the host can reach the FPL servers.
- Request `/api/players` from two different networks and check that `RateLimit-Remaining` counts separately. If it does not, `SCOUTIQ_TRUST_PROXY` is wrong.

## Alternative: one server with Docker Compose

On a small VPS, with a reverse proxy such as Caddy terminating TLS on the same machine:

```sh
cp .env.example .env        # set POSTGRES_PASSWORD and FRONTEND_URL
SCOUTIQ_TRUST_PROXY=loopback docker compose --profile app up -d --build
```

The app listens on `127.0.0.1:3001` and PostgreSQL on `127.0.0.1:5432`, so neither is reachable from outside. Point the refresh workflow at the database through an SSH tunnel, or run `pnpm run refresh:fpl --fetch-history` from cron on the server. Back up the `postgres-data` volume.

## Roll back

- **Bad release:** redeploy the previous image or commit, then rerun the smoke check. Migrations only add tables, so an older build runs against a newer schema.
- **Bad data:** rerun the refresh. Each run replaces the current snapshot. If the FPL feed itself is wrong, the previous projections stay in place until a later run succeeds.

## Rehearse locally with synthetic data

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

In another terminal:

```sh
pnpm exec playwright install chromium
SCOUTIQ_WEB_URL=http://localhost:3001 SCOUTIQ_BROWSER_FIXTURE=1 pnpm run test:browser
POSTGRES_PORT=55432 SCOUTIQ_BROWSER_FIXTURE=1 pnpm run test:planning-db
```

CI runs the same journey on every pull request. Sample mode shows a banner, disables public team import and keeps `/api/ready` at 503.
