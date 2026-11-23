# Security

ScoutIQ has no accounts, stores no personal data and holds no secrets in the browser. A saved squad lives in the visitor's own browser storage. The server side holds one database of public FPL data and, optionally, one language-model API key.

## What is exposed

| Surface | Notes |
| --- | --- |
| `GET` endpoints | Public FPL data and projections. Cached and rate limited. |
| Planning `POST` endpoints | CPU work on visitor-supplied squads. Validated with strict schemas and rate limited per address and globally. |
| `POST /api/entries/import` | Calls the public FPL API for a numeric team ID. The ID is the only visitor input in the outbound request, the host is fixed, redirects are refused and responses are size limited. |
| `POST /api/agent/explain-recommendation` | Only reaches a paid provider when one is configured. Every field is size limited, names accept name characters only, output tokens are capped and calls are budgeted per day. Output must pass a schema and may only name players in the request. |

## Controls in the code

- **Headers:** Helmet with a content security policy that allows scripts and connections from the same origin only, with no inline scripts.
- **CORS:** one configured origin, no credentials.
- **Limits:** request bodies up to 512 KB, header and request timeouts, per-address and global rate limits. See [Running costs](COSTS.md) for the numbers.
- **Client address:** forwarded headers are ignored unless `SCOUTIQ_TRUST_PROXY` says how many proxies to trust.
- **Database:** parameterised queries throughout, TLS with certificate verification when `DATABASE_SSL=true`, and a production start refuses the public local default password.
- **Errors:** responses carry a fixed message. Stack traces, SQL and provider errors are never returned.
- **Secrets:** `.env` files and credential formats are git-ignored. `pnpm run security:frontend` fails if the web bundle names a server-only variable or contains a token pattern, and CI runs it. A `.gitleaks.toml` is included for `gitleaks detect`.
- **Supply chain:** CI audits production dependencies and pins GitHub Actions to commit hashes.

## Known limits

- Rate limits are held in memory, so they reset on restart and assume a single instance.
- The explanation endpoint trusts the lineup the browser sends. A visitor can ask for an explanation of a made-up lineup, and the only person who sees the result is that visitor.
- There is no web application firewall in the app. Put a CDN with DDoS protection in front for public traffic.

## Rotating credentials

- **Database password:** change it at the provider, then update `DATABASE_URL` on the web service and in the repository's Actions secret.
- **Language-model key:** revoke it at the provider and set the new value on the web service. The app falls back to built-in text while no valid key is present.

## Reporting a problem

Open a private security advisory on the GitHub repository. Please do not file a public issue for anything exploitable.
