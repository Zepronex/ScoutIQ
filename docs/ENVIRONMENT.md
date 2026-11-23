# Environment Reference

This reference covers configuration used by the current ScoutIQ codebase and the example environment files. Do not commit real `.env` files, credentials, service account files, database dumps, or provider keys.

## Active Runtime Variables

| Variable | Used by | Local demo | Production API | Live LLM mode | Secret | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | API error handling | Optional | Recommended | No | No | Use `production` for hosted API runtime. Development mode can include error details. |
| `PORT` | API server | Optional | Required when the host sets an expected port | No | No | Defaults to `3001` locally. |
| `FRONTEND_URL` | API CORS | Optional | Required for a deployed frontend origin | No | No | Defaults to `http://localhost:3000`; set to the deployed frontend origin before production traffic. |
| `SCOUTIQ_DATA_MODE` | API and UI | Optional | Use `fpl` for public FPL captures | No | No | Set `sample` for synthetic data. It displays a practice banner, disables public pick import and returns 503 readiness. |
| `SCOUTIQ_TRUST_PROXY` | Express client IP | Optional | Required behind any proxy | No | No | Number of proxies in front (1 to 5), or comma-separated trusted IPs/CIDRs, or `loopback`. Keep empty for direct traffic. |
| `SCOUTIQ_RATE_LIMIT` | API rate limits | Optional | Optional | No | No | API calls per address per 15 minutes. Default 300. |
| `SCOUTIQ_GLOBAL_PLANNING_LIMIT` | API rate limits | Optional | Optional | No | No | Planning POSTs from all callers per 15 minutes. Default 900. |
| `SCOUTIQ_GLOBAL_IMPORT_LIMIT` | API rate limits | Optional | Optional | No | No | Public team imports from all callers per 15 minutes. Default 150. |
| `SCOUTIQ_AGENT_DAILY_LIMIT` | Explanation provider | Optional | Optional | Recommended | No | Paid provider calls per UTC day. Default 200. Past it the built-in text is used. |
| `SCOUTIQ_PREDICTION_RUNS_KEPT` | Refresh job | Optional | Batch job only | No | No | Projection runs kept after each refresh. Default 30. |
| `DATABASE_POOL_MAX` | API database pool | Optional | Optional | No | No | Connections held by the web service. Default 5. |
| `SCOUTIQ_API_PORT` | Local dev launcher | Optional | No | No | No | Port for the API under `pnpm run dev`. Default 3001. |
| `SCOUTIQ_APP_VERSION` | API health response | Optional | Optional | No | No | Adds a safe version label to `GET /api/health`. |
| `DATABASE_URL` | API database config and database scripts | Optional when component variables are set | Required unless component variables are set | No | Yes | Preferred production setting because most managed PostgreSQL providers expose one URL. |
| `DATABASE_SSL` | API database config | Optional | Required when the database provider requires SSL | No | No | Enables verified TLS. Use the provider’s CA via `NODE_EXTRA_CA_CERTS` when needed. |
| `POSTGRES_HOST` | API database config | Optional | Alternative to `DATABASE_URL` | No | No | Defaults to `localhost` when `DATABASE_URL` is absent. |
| `POSTGRES_PORT` | API database config and Docker Compose | Optional | Alternative to `DATABASE_URL` | No | No | Defaults to `5432`. |
| `POSTGRES_DB` | API database config and Docker Compose | Optional | Alternative to `DATABASE_URL` | No | No | Defaults to `scoutiq`. |
| `POSTGRES_USER` | API database config and Docker Compose | Optional | Alternative to `DATABASE_URL` | No | No | Defaults to `scoutiq`. |
| `POSTGRES_PASSWORD` | API database config and Docker Compose | Optional for local defaults | Alternative to `DATABASE_URL` | No | Yes | Required if component variables are used for a non-default database. |
| `SCOUTIQ_AGENT_ENABLED` | Explanation agent | Optional | Optional | Required | No | Leave `false` for deterministic fallback. Set `true` only when provider config is available and tested. |
| `SCOUTIQ_AGENT_PROVIDER` | Explanation agent | Optional | Optional | Optional | No | Supports `auto`, `openai`, or `azure_openai`; defaults to `auto`. |
| `SCOUTIQ_AGENT_TIMEOUT_MS` | Explanation agent | Optional | Optional | Optional | No | Defaults to `10000`. |
| `OPENAI_API_KEY` | OpenAI explanation provider | No | Optional | Required for OpenAI mode | Yes | Keep private in the deployment secret store. |
| `OPENAI_MODEL` | OpenAI explanation provider | No | Optional | Required for OpenAI mode | No | Required together with `OPENAI_API_KEY`. |
| `OPENAI_BASE_URL` | OpenAI explanation provider | No | Optional | Optional | No | Defaults to `https://api.openai.com/v1`. |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI explanation provider | No | Optional | Required for Azure mode | Yes | Keep private in the deployment secret store. |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI explanation provider | No | Optional | Required for Azure mode | No | Endpoint URL for the Azure OpenAI resource. |
| `AZURE_OPENAI_DEPLOYMENT` | Azure OpenAI explanation provider | No | Optional | Required for Azure mode unless `AZURE_OPENAI_MODEL` is set | No | Preferred Azure deployment variable. |
| `AZURE_OPENAI_MODEL` | Azure OpenAI explanation provider | No | Optional | Alternative Azure deployment variable | No | Current code accepts this as a fallback for `AZURE_OPENAI_DEPLOYMENT`. |
| `FPL_SEASON` | FPL ingestion | Optional | Batch job only | No | No | Optional season override. The importer normally infers it from the Gameweek 1 deadline. |
| `SCOUTIQ_API_URL` | Smoke test script | Optional | Deployment smoke checks only | No | No | Defaults to `http://localhost:3001`; set to deployed API base URL for smoke checks. |
| `SCOUTIQ_WEB_URL` | Smoke test script | Optional | Deployment smoke checks only | No | No | Defaults to `http://localhost:3000`; set to deployed frontend base URL for smoke checks. |
| `SCOUTIQ_SMOKE_REQUIRE_READY` | Smoke test script | Optional | Use `1` for a public release smoke check | No | No | Requires current, non-sample projections. |
| `SCOUTIQ_PYTHON` | Refresh script | Optional | Batch job only | No | No | Defaults to `python3` on Unix and `python` on Windows. |
| `SCOUTIQ_SMOKE_TIMEOUT_MS` | Smoke test script | Optional | Deployment smoke checks only | No | No | Defaults to `5000`. |

## Frontend Variables

`apps/web/.env.example` currently lists:

| Variable | Current status | Notes |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Build-time | Defaults to `/api`. For a separate API host use its public URL including `/api` and configure `FRONTEND_URL`. Treat all `VITE_*` values as public. |

## Pipeline And Data Paths

The current batch pipeline uses command defaults and CLI flags rather than deployment environment variables for data paths. Generated local artifacts live under gitignored `data/` paths by default. Database loaders read the default paths from `apps/api/src/db/config.ts` unless code or command arguments are changed.

Production-like batch runs should keep generated artifacts and database credentials outside source control.
