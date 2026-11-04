# @centurion/core

Shared data layer for `apps/shopify` and `apps/web`. It builds the AI Sales view in one place and stores report runs in Postgres, so the two apps cannot disagree about a number.

## Entry points

| Import | Safe in the browser | Contents |
| --- | --- | --- |
| `@centurion/core` | Yes | View and feature types, display wording, the committed test-page checkout run |
| `@centurion/core/server` | No | View builder, Postgres store (save run, load latest view, uninstall, redact), Shopify fetch, Admin API tokens (`getShopifyToken`), AI Answer Check |

## AI Answer Check (`src/answer-check/`)

Asks AI assistants the questions shoppers ask about a store and flags answers that contradict its catalog.

| File | What it does |
| --- | --- |
| `questions.ts` | Builds the questions from fixed templates (product overview, spec facts, price, stock, policies) |
| `providers.ts` | Meta Muse Spark through the Meta Model API (`api.meta.ai`, OpenAI-compatible), live when `META_API_KEY` is set (`META_MODEL`, `META_API_BASE_URL` optional). Without a key, Meta, ChatGPT, Perplexity and Gemini return DEMO fixture answers (`demo-fixtures.ts`), labeled as such |
| `compare.ts` | The check. Plain rules, no model: banned claims (ignoring negated ones like "not waterproof"), numbers with units normalized across g/kg/lb, L, °C/°F, cm/in, days/years and dollars, and stock. Every issue names the catalog fact and its source |
| `run.ts` | Runs every question past every provider. A provider error marks one answer as an error; the run always finishes |
| `shopify-catalog.ts` | Builds a catalog from a live store's products and `centurion.*` claim metafields |
| `demo-catalog.ts` | The fictional Northpine catalog, mirroring `apps/gateway/data/rulebook.json` |

`saveAnswerCheck` and `loadLatestAnswerCheck` store runs in the `answer_checks` table.

## Weekly Fix (`src/weekly-fix.ts`)

`suggestFix({ sales, answerCheck, catalog })` is the rule: among products AI already sells, the one with the most AI revenue that Answer Check found a banned claim or wrong spec fact on gets the catalog's own facts added to the top of its description; the next two AI sellers are holdouts. `explainFix` lets Meta Muse Spark reword the explanation (kept only if it keeps the numbers), never the choice. `applyFix` and `undoFix` work through a `ProductAdmin` interface (`shopifyProductAdmin` uses `productUpdate`) and refuse to run unless `CENTURION_STORE_WRITES=on`. Apply records the description as the store saved it (read back after the write); undo compares whitespace-normalized HTML, refuses to overwrite later edits, and reports `already_undone` when the old text is already back. `measureFix` compares the product's AI revenue per day with its holdouts' (difference in differences), using only AI orders placed since the fix (`aiRevenueSince`). In `weekly_fixes`, `reserveFix` takes the store's single fix slot before the store is written, then `completeFix` records it (or `releaseFix` gives the slot back); `latestFix` and `markFixUndone` read and close it. `DEMO_SALES_SNAPSHOT` is the demo report's numbers for showing the rule on demo data.

## Checkout test runs

`checkout-types.ts` holds the run shape the worker in `packages/checkout-test` produces. `saveCheckoutRun`, `loadLatestCheckoutRun` and `checkoutFailureCounts` read and write `checkout_runs`, the failure corpus. `TEST_PAGE_CHECKOUT_RUN` (`checkout-sample.ts`) is a real run on the local test page, shown by both apps until a store is tested.

## Background report runs (`src/jobs.ts`)

`startReportJob(db, { shop, days, fetchOrders })` creates the run (`running`) and returns its id at once; the injected `fetchOrders` and the store step run afterwards, and `done` settles as `done` or `failed`, never rejecting. `retryingRunner` wraps a GraphQL runner so throttled pages (`THROTTLED` or HTTP 429) are retried with exponential backoff. Only one report runs per shop at a time (`RunInProgressError` carries the running run's id). The fetcher calls `progress()` as pages arrive to keep the run's heartbeat fresh; `failStaleRuns` fails runs with no progress for 10 minutes (a stopped process), and a run already failed can never flip to `done`. `latestReportRun` gives the status for polling. `saveReportRun` is the same steps run inline.

`getShopifyToken()` exchanges `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` for an Admin API access token on `SHOPIFY_SHOP` using the client credentials grant, which works for Dev Dashboard apps in the same Shopify organization as the store. Tokens are cached per shop and client ID and refreshed when less than a minute remains. `createShopifyAuth({ fetch, now, env })` builds an independent instance for tests. The file has no dependencies, so `packages/attribution` imports it by relative path.

The package ships TypeScript source and is compiled by each consumer (Vite, Next.js, tsx). Imports use explicit `.ts` extensions.

## Commands

```bash
npm install
npm test             # includes a Postgres round trip on PGlite
npm run typecheck
```

Set `TEST_DATABASE_URL` to also run the round trip against a real Postgres database.
