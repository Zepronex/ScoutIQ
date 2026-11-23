# Command Reference

Use these commands from the repository root. The examples use `pnpm` because this project is developed and reviewed primarily from Windows PowerShell.

## Core Local App

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install workspace dependencies. |
| `pnpm run dev:app` | Start the API and web app for normal local development and demos. |
| `pnpm run dev:api` | Start only the API service. |
| `pnpm run dev:web` | Start only the web app. |

`dev:app` is the default command for ScoutIQ demo work. It starts the API and web app only and does not require an OpenAI API key.

## Smoke Checks

| Command | Purpose |
| --- | --- |
| `pnpm run smoke:app` | Check a running local API and web app. |
| `pnpm run test:smoke` | Run unit tests for the smoke-test helper script. |

`smoke:app` expects `dev:app` to already be running. It checks health, agent status, evaluation, home, evaluation page, and analyze page endpoints.

## Build And Test

| Command | Purpose |
| --- | --- |
| `pnpm run build` | Build the API and web app workspaces. |
| `pnpm run build:api` | Type-check and build the API. |
| `pnpm run build:web` | Type-check and build the web app. |
| `pnpm run test:api` | Run API unit and integration-style tests. |
| `pnpm run pipeline:test` | Run Databricks/lakehouse pipeline tests. |
| `pnpm run model:test` | Run expected-points model pipeline tests. |

For documentation-only changes, `test:smoke` and `git diff --check` are usually enough before an intermediate commit. Before merging product or data-path changes, run the relevant build and test commands above.

## CI Reproduction

GitHub Actions validates pull requests and pushes to `dev` with `.github/workflows/ci.yml`. It uses Node 20, pnpm 9, and Python 3.12 for pipeline and model tests.

CI runs without OpenAI or Azure OpenAI keys, local `.env` files, Docker, PostgreSQL, or live FPL API calls. Explanation-agent coverage uses mocked provider responses and deterministic fallback behavior.

To reproduce the CI checks locally from Windows PowerShell:

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm run build:api
pnpm run build:web
pnpm run test:api
pnpm run test:smoke
pnpm run pipeline:test
pnpm run model:test
```

## Database And Ingestion

| Command | Purpose |
| --- | --- |
| `docker compose up -d postgres` | Start local PostgreSQL. |
| `pnpm run db:migrate` | Apply database migrations from `db/migrations`. |
| `pnpm run ingest:fpl` | Fetch and normalize public FPL bootstrap and fixture data. |
| `pnpm run ingest:fpl:history` | Fetch public player gameweek history. |
| `pnpm run db:load:fpl` | Load normalized FPL data into PostgreSQL. |
| `pnpm run db:load:predictions` | Load generated prediction and evaluation artifacts into PostgreSQL. |

PowerShell wrappers are available in `scripts/` for migration, ingestion, and database load workflows.

## Full Data And Prediction Flow

Run this sequence when a reviewer needs a full local data refresh and prediction-backed optimizer demo:

```powershell
docker compose up -d postgres
pnpm run db:migrate
pnpm run ingest:fpl
pnpm run db:load:fpl
pnpm run ingest:fpl:history
pnpm run pipeline:features
pnpm run model:train
pnpm run model:backtest
pnpm run model:predict
pnpm run db:load:predictions
pnpm run dev:app
```

Then verify from a second terminal:

```powershell
pnpm run smoke:app
```

## Pipeline And Model Commands

| Command | Purpose |
| --- | --- |
| `pnpm run pipeline:bronze` | Build source-preserving Bronze lakehouse rows. |
| `pnpm run pipeline:silver` | Build typed Silver lakehouse rows. |
| `pnpm run pipeline:gold` | Build feature-oriented Gold rows. |
| `pnpm run pipeline:features` | Build expected-points feature and training rows. |
| `pnpm run pipeline:all` | Run the lakehouse pipeline end to end. |
| `pnpm run model:train` | Train the expected-points baseline model. |
| `pnpm run model:backtest` | Run walk-forward expected-points backtesting. |
| `pnpm run model:predict` | Generate prediction rows for serving. |

Generated feature, model, evaluation, and prediction artifacts are written under gitignored `data/` paths.

## Optional Provider Configuration

The deterministic explanation fallback works without provider credentials. To test a live provider locally, keep private values only in local `.env` files:

```powershell
SCOUTIQ_AGENT_ENABLED=true
SCOUTIQ_AGENT_PROVIDER=openai
OPENAI_API_KEY=<private key>
OPENAI_MODEL=<model name>
```

Never commit real secrets, local `.env` files, service account files, or database dumps.
