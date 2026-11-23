# ScoutIQ production readiness

**Ready for staging.** The production Node build, PostgreSQL 16 setup, official 2026–27 Gameweek 11 data path and local browser journeys were exercised. Public release depends on the host, managed database TLS, proxy addresses, scheduled refresh and one live public-entry import. Follow the [deployment runbook](DEPLOYMENT.md).

## Baseline

The worktree started clean on `dev`. The existing dependency directory lacked `express-slow-down`. A frozen install restored the API. Using a disposable database loaded with the archived 2025–26 snapshot, the original browser flow added 15 players by name and reached the analysis and optimizer. All 82 original API tests passed. The routes covered home, squad, top players, analysis, player detail and model evaluation. The API also exposed draft generation, fixture-level prediction endpoints and optional explanation providers. The archived data contained 841 projection rows for Gameweek 38.

The current-season check captured official bootstrap and fixture data on 11 November 2026 at 22:57 UTC. After fixing nullable team strength, that capture produced 672 players, 20 teams, 38 events and 380 fixtures. One history capture yielded 6,562 player-gameweek rows. Subsequent repetitions replayed these local files or used synthetic fixtures. The next FPL deadline was 21 November 2026 at 11:00 UTC, which the Stockholm browser displayed as 12:00.

## Findings

| Severity | Reproduction and expected behavior | Observed cause | Change and evidence |
| --- | --- | --- | --- |
| Critical | Load the current official bootstrap into an empty database. All teams should normalize. | All 20 teams had a null strength value rejected by the raw schema. | Accepted null strengths. Captured and published the live Gameweek 11 data, with a regression in the normalizer suite. |
| Critical | Keep an older run loaded across the next deadline or a season rollover. Its players and totals should never appear as current advice. | The planner selected the newest stored prediction run by creation order, and gameweek IDs repeat. | The current snapshot and first open deadline constrain planning. PostgreSQL assertions covered the instant before, at and after the cutoff, no remaining deadlines and a different snapshot with the same gameweek ID. |
| Critical | Compare transfers on a full 841-row archive. The request should return while the manager waits. | The double search constructed and validated eight full lineups for every legal pair. The baseline request exceeded the 20-second client timeout. | Score legal pairs using the retained XI's position cutoffs and construct only the winning lineups. The same archived squad and allowance returned in 370–462 ms over three local calls. |
| High | Use a real bank and selling prices and compare a paid transfer with keeping the squad. | Draft assumptions fixed spending at £100.0m, used market prices on both sides and could recommend negative gains. | Existing squads use confirmed inputs, complete selling prices and net points after hits. Independent regression covered £0.7m available, £0.6m rejected, and 20 → 30 points before a four-point hit. |
| High | Generate a tight but feasible draft with cheap keepers competing for club places with forwards. | Greedy completion used the club places needed by the forwards and declared a legal £62.0m roster impossible. | The fallback computes the cheapest legal completion across position and club constraints. £62.0m passed and £61.9m failed. |
| High | Rank all goalkeepers and compare players in a double or blank gameweek. | The original web list truncated to 100 rows overall before filtering. The archive showed 9 goalkeepers in that list versus 97 in the position query. Fixture rows could rank the same player twice. | Current rankings use per-player totals and filter the full pool. The synthetic database verified both fixture IDs in the double, a withheld partial double, a confirmed blank and an unavailable player with zero. |
| High | Open the planner on a 390px phone and use search, draft or import. | The original header measured 605px and forced horizontal scrolling. Old requests could also overwrite search results and player detail treated an absent score as zero. | Reworked the navigation, roster, rankings and loading states. Browser coverage exercises 360px, keyboard activation, delayed search, unknown IDs and direct routes. |
| High | Assess the lockfile and repeat valid planning requests. | The starting production audit reported one critical and 19 high advisories. Expensive POSTs were excluded from the strict limiter when successful. | Updated affected dependencies and removed unused concurrent runner. Full and production audits reported zero known advisories. Tests exercised the successful-POST rate limit, malformed JSON and oversized request rejection. |
| Medium | Rehearse the built app with a deep link and a real JavaScript entry. | The smoke helper required a development source path and could accept a page whose rewrite swallowed its assets. | The helper validates both Vite modes and checks the entry's content type. The Node service serves the built SPA and separates API and asset errors. |
| Medium | Review an XI when the optional explanation service fails. | An explanation request ran automatically after every optimizer result. | Explanation is on demand with a retry. Browser checks kept the lineup visible through a simulated failure and displayed the deterministic fallback on retry. |

## FPL checks

- Drafts have 2 goalkeepers, 5 defenders, 5 midfielders and 3 forwards under a £100.0m initial budget and a three-player club cap. Existing squads can be shown after a real-world club move, but a recommended transfer must restore the club limit. [Official squad guide](https://www.premierleague.com/en/news/2174419)
- The XI has one goalkeeper, at least three defenders and at least one forward. The goalkeeper substitute is separate from the outfield priority. Captain and vice-captain are distinct starters. Projected totals count the captain twice and do not simulate automatic substitutions. [Official team-management guide](https://www.premierleague.com/en/news/2174899/fpl-basics-managing-your-team)
- FPL can bank up to five free transfers and charges four points per extra move. ScoutIQ uses entered selling prices for owned players. The fixture sold at £5.8m and bought at £6.5m, used £0.7m exactly, and returned +6 points after a four-point hit. [Official transfers guide](https://www.premierleague.com/en/news/2174907/1000), [FPL FAQs](https://fantasy.premierleague.com/help/faqs)
- The stored fixture schedule supplies the target horizon. An unassigned rescheduled fixture is excluded. A scheduled double counts both fixtures and a confirmed blank contributes zero. Missing projections remain unavailable. [Official fixture feed](https://fantasy.premierleague.com/api/fixtures/)

The transfer planner ranks the best valid option for each allowed count of one or two moves on the same gameweek horizon. It also shows keeping the squad. Draft generation is a heuristic with a feasibility fallback. The planner's scope is standard captaincy and the next open gameweek. Chip effects, multi-gameweek strategy and private FPL account synchronization are outside that scope. Public picks are a deadline snapshot and may include a temporary squad from a chip. Always reconcile later moves, bank and selling prices in the official game.

The local Gameweek 11 replay backtested 5,326 predictions from completed gameweeks. MAE was 1.3685 versus 1.2268 for the recent-points baseline. RMSE was 2.2457 versus 2.3049. The measures point in different directions. These are snapshot-specific historical metrics.

## Verification and remaining work

The [browser suite](../scripts/browser-app.test.mjs) exercises desktop and phone draft or manual entry, persistent squads, keyboard navigation, filters and pagination, provisional import, finance inputs, lineup and transfer comparisons, missing data and retries. The import suite uses synthetic upstream responses. [PostgreSQL fixture tests](../scripts/planning-db.test.ts) exercise actual serving queries against the sample database and roll their changes back.

The release smoke checks cover liveness, agent status, evaluation, built JavaScript, SPA deep links, readiness and current player projections. The production API reported 503 for sample data, expired projections and unavailable PostgreSQL while retaining a live process. A mismatched run pin returned 409 and an infeasible reserve returned 422. The managed database, host HTTPS, proxy trust, scheduler, and public import need the staging verification in the runbook. Remote Databricks jobs and hosted explanation providers were outside this rehearsal.

| Command | Local result |
| --- | --- |
| `pnpm install --frozen-lockfile` and `pnpm run build` | Passed, including both TypeScript builds and Vite assets. The lockfile also passed a frozen pnpm 9.15.9 check. |
| `pnpm run test:api` and `pnpm run test:smoke` | 92 API and 6 smoke helper tests passed. |
| `pnpm run test:browser` | 6 passed with the captured official data and 7 passed with the synthetic dataset. The blank and double fixture case runs only in the synthetic suite. |
| `pnpm run test:planning-db` | Passed against the disposable fixture database. |
| `pnpm run pipeline:test`, `model:test`, `databricks:snapshot:test`, `resume:metrics:test` | 15, 7, 6 and 2 tests passed respectively. |
| `SPARK_LOCAL_IP=127.0.0.1 pnpm run databricks:test` | 9 passed. The default macOS hostname could not bind Spark, so the rerun used loopback. |
| `pnpm run db:migrate`, `refresh:fpl`, `smoke:app` | Three migrations applied to fresh databases and the existing schema was up to date. Official and synthetic replays published successfully. A mismatched artifact was refused. Production smoke passed on both builds. |
| `pnpm audit`, `pnpm audit --prod`, `docker compose config --quiet`, `git diff --check` | Passed. Both audits reported zero known advisories. |

The workspace has no standalone lint script. Browser execution used Chrome at 1440px and 360px. Hosted deployment and other browser engines remain outside the local rehearsal.
