# Running costs and spending safeguards

Prices below were read from each provider's own pricing page on 23 November 2026. They change, so confirm them before you sign up. Totals are simple arithmetic on those published prices.

## What ScoutIQ needs

| Part | Size | Why it is small |
| --- | --- | --- |
| Web service | One container, 256 to 512 MB RAM. It idles at about 33 MB. | Lineups and transfers are computed in milliseconds and shared reads are cached. |
| PostgreSQL 16 | About 11 MB of data, five connections. | Only the 30 newest projection runs are kept. |
| Data refresh | About three minutes, four times a day. | Runs on GitHub Actions, outside the web service. |
| Explanation text | Free by default. | Written by fixed rules unless you turn on a language model. |

## Estimate

| Setup | Monthly cost | Can the bill exceed that? |
| --- | --- | --- |
| **Railway Hobby** (recommended): web service and PostgreSQL in one project | $5 plan fee, which includes $5 of usage. Expect $5 to $8. | No. Set a hard usage limit (minimum $10) and Railway takes the services offline when it is reached. |
| **Hetzner Cloud** CPX02 or CX23 running `docker compose --profile app` | €5.49 to €6.49 excluding VAT | No. The price is fixed with 20 TB of traffic included. You maintain the server, TLS and backups yourself. |
| **Render** Starter web service and its smallest PostgreSQL | $7 + $6 + $0.30 storage = $13.30 | Yes, slightly. Bandwidth beyond 5 GB costs $0.15 per GB and there is no cap. |

Add to any of them:

| Item | Cost |
| --- | --- |
| Domain (.com at cost) | about $10.50 a year |
| Cloudflare Free in front of the service | $0 |
| GitHub Actions for the refresh | $0. About 360 minutes a month. Public repositories are free, and a private one stays inside the $12 monthly allowance. |
| Language-model explanations, if enabled | At most about $4.20 a month. See below. |

**Expected total: about $6 to $9 a month** on Railway with a domain, and the same with explanations left on the free built-in text.

### If you enable language-model explanations

One explanation is roughly 3,000 input and 800 output tokens. On OpenAI's `gpt-6-luna` ($0.10 and $0.50 per million tokens) that is about $0.0007 a call. `SCOUTIQ_AGENT_DAILY_LIMIT` defaults to 200 calls a day across all visitors, so the ceiling is 200 × 30 × $0.0007 ≈ $4.20 a month. After the daily limit, visitors get the free built-in text. Set a monthly budget in the provider's dashboard as a second limit.

## What stops a bot from running up the bill

The service has no accounts, so every limit is by address or global.

| Risk | Safeguard | Setting |
| --- | --- | --- |
| Flooding any endpoint | 300 API calls per address per 15 minutes, slowing down after 150 | `SCOUTIQ_RATE_LIMIT` |
| Hammering the CPU-heavy planner | 10 draft or transfer requests and 30 lineup or squad reviews per address per 15 minutes | fixed |
| Many addresses at once (a botnet) | A ceiling of 900 planning requests per 15 minutes for everyone combined. Above it the service answers 503 instead of working harder. | `SCOUTIQ_GLOBAL_PLANNING_LIMIT` |
| Using ScoutIQ to hit the FPL servers | 10 imports per address and 150 for everyone per 15 minutes, and a ten-minute cache per team | `SCOUTIQ_GLOBAL_IMPORT_LIMIT` |
| Paid language-model calls | Off by default. 200 calls a day for everyone, 1,200 output tokens a call, and every input field capped in size. | `SCOUTIQ_AGENT_DAILY_LIMIT` |
| Bandwidth | Responses are gzipped (the main payload is 16 KB instead of 174 KB) and assets are cached for a year | fixed |
| Database load | Shared reads are cached for 10 to 30 seconds, five pooled connections, five-second statement timeout | `DATABASE_POOL_MAX` |
| Database growth | Old projection runs are deleted on each refresh | `SCOUTIQ_PREDICTION_RUNS_KEPT` |
| Oversized or slow requests | 512 KB body limit, 15-second header and 30-second request timeouts | fixed |
| Crawlers | `robots.txt` disallows `/api/` | fixed |

Three things to do on the hosting side:

1. **Set the platform's hard spending limit** (Railway: Workspace → Usage → Hard limit). This is the only control that bounds the bill whatever the code does.
2. **Run one instance.** The limits above are counted in memory. A second instance would double every allowance.
3. **Set `SCOUTIQ_TRUST_PROXY`** to the number of proxies in front of the service (1 on Railway, 2 with Cloudflare in front). Without it every visitor shares one address and one limit.

Putting Cloudflare's free plan in front adds unmetered DDoS protection and one free rate-limiting rule. Leave Bot Fight Mode off, because it can challenge the app's own API calls.

## What the safeguards do not cover

- A determined attacker can still use the global planning ceiling to make the planner unavailable to others for up to 15 minutes. The bill does not grow, but the service degrades. Cloudflare in front is the mitigation.
- Limits reset when the service restarts.
- Usage-priced hosts with no spending cap (Fly.io, Render bandwidth, Neon paid plans) rely on the limits above alone. Prefer a capped or fixed-price host.
