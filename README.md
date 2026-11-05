# Centurion

Centurion is an AI commerce analyst for Shopify brands. It shows which sales came from AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Meta AI) with the evidence for every order, finds what AI tells shoppers about the products that contradicts the catalog, fixes it in the store in one click, and tests whether an AI shopping agent can reach checkout. **Ask Centurion**, an analyst on Meta's Muse Spark model, answers questions from the store's own data with charts and takes those actions inside the chat.

Built for the Meta Global AI Hackathon, Indie Dev track, "Build Your World" (Oct 26 to Nov 4, 2026).

## Design rules

- **Attribution is deterministic.** No language model decides which orders count or how much revenue AI sent. Every number traces back to an order ID and the signal that matched.
- **No overclaiming.** A direct visit to a product page is reported as "worth watching", never as AI revenue.
- **Official APIs only.** AI answers are read through model provider APIs, never by scraping chat interfaces.

## Repository layout

```
apps/
  shopify/        Embedded Shopify admin app (Polaris)
  web/            Standalone app on a fictional mid-market store, no Shopify account needed
  gateway/        MCP server that answers outside AI agents with a brand's verified facts
packages/
  attribution/    Order classifier, AI source signatures, sample store generator, reports and CLI
  checkout-test/  Agent Checkout worker (Playwright) and its local test store
  core/           Shared logic for both apps: view builder, Answer Check, fixes, Ask Centurion, Postgres store
supabase/
  migrations/     Postgres schema
```

| Package | Status |
| --- | --- |
| `apps/web` | Three tabs on the fictional Northpine store (60 products, 237 SKUs, 12,000 orders): **AI Revenue** (click-to-filter explorer), **Fix AI Answers** (wrong answers ranked by AI revenue at stake, with the fix and Apply), **Agent Checkout** (animated replay of a recorded agent run). **Ask Centurion** in a corner chat: Muse Spark answers with metrics, charts and tables, runs actions, keeps history, takes voice input, and nudges when something needs attention. Command palette (Ctrl/⌘ K) and keyboard shortcuts. |
| `apps/shopify` | AI Sales runs end to end on a store's orders. Answer Check, Checkout Test and Weekly Fix as before, plus an **Ask Centurion** page with the same structured answers and actions, including applying and undoing the fix on the live store. Shows labeled sample data until the store has AI orders of its own. |
| `apps/gateway` | Working MCP server on sample data with development tokens. Not part of this release. |
| `packages/attribution` | Classifier, report and signature dataset tooling, and the seeded sample store generator, with tests. |
| `packages/core` | Shared logic for both apps, with tests: attribution view, Answer Check, Weekly Fix and live store writes, Ask Centurion (prompting, JSON parsing and safety rules), and a Postgres round trip on PGlite. |
| `packages/checkout-test` | Checkout agent in headless Chromium: video, step log, payment guard, failure corpus table. Tested against a local test store. |

## Where we use Meta AI

Centurion calls **Meta Muse Spark (`muse-spark-1.3`) through the Meta Model API** (`POST https://api.meta.ai/v1/chat/completions`, OpenAI-compatible). Every call lives in `packages/core`, shared by both apps.

1. **Ask Centurion** (`packages/core/src/assistant.ts`). Each question goes to Muse Spark with a compact briefing of the store's data (AI revenue by assistant and month, journeys, proof types, top products, weekly revenue, unattributed orders, wrong AI answers). The prompt requires answers only from that data, quoting the numbers. JSON mode (`response_format: json_object`) returns a headline, key metrics, bullets, an optional table, a chart name and next actions.
   - **The model never supplies chart numbers.** It picks a named dataset; the values are filled in from the store data.
   - **The model never runs code.** It picks action ids from a fixed list; fixed server code runs them (`apps/web/app/api/action`, `apps/shopify/app/centurion.server.ts`). Unknown datasets and actions are dropped (`packages/core/test/assistant.test.ts`).
   - `reasoning_effort: low` keeps answers to about 7 to 10 seconds (about 20 without it). Override with `META_REASONING_EFFORT`.
2. **Answer Check** (`packages/core/src/answer-check`). Muse Spark answers the questions shoppers ask about best sellers and policies; plain code (`compare.ts`) checks every answer against the catalog and banned claims. The model answers; it never judges. A decline ("I don't know if it's waterproof") counts as no answer, not a contradiction.
3. **Weekly Fix explanations.** Muse Spark may reword the fix's explanation; the rewrite is kept only if every number and fact still matches.

**What never touches a model:** which orders count as AI revenue, whether an answer is right, which product gets fixed, and what is written to the store.

The demo screens use labeled sample answers so they render instantly and identically; the Ask Centurion chat is live whenever `META_API_KEY` is set. Voice input uses the browser's speech recognition (Chrome, Edge, Safari).

## How AI Sales works

1. The merchant presses **Run report** in Shopify admin.
2. The app reads the last 60 days of orders through the Admin GraphQL API (`read_orders`), including each order's first and last visit from `customerJourneySummary`.
3. `packages/attribution` matches each order against the signature dataset (`packages/attribution/data/signatures.json`) and records the evidence: an AI sales channel, an AI referrer, or an AI UTM tag, plus whether AI was the first touch, the last touch, or both.
4. The run is saved to Postgres, and the screen is rebuilt from the stored rows.

## Getting started

Requires Node 22.12 or newer. Each package installs on its own; shared code is linked with `file:` dependencies.

```bash
# Tests
cd packages/attribution && npm install && npm test
cd packages/core && npm install && npm test

# Web app on the demo store (http://localhost:3000)
cd apps/web && npm install && npm run dev

# Shopify app: needs a Shopify Partner account, a development store and Shopify CLI 5.0+
cd apps/shopify && npm install && shopify app dev
```

Environment variables. Each app reads its own file: `apps/web/.env.local` and `apps/shopify/.env`. Never put keys in `shopify.app.toml`.

| Variable | Used by | What it does |
| --- | --- | --- |
| `META_API_KEY` | both | Turns on Ask Centurion (and live Answer Check runs) on Meta Muse Spark |
| `META_MODEL`, `META_REASONING_EFFORT` | both | Optional: model (default `muse-spark-1.3`) and reasoning effort (default `low` for the chat) |
| `CENTURION_STORE_WRITES=on` | both | Lets Apply and Undo write the fix to the store (the app needs `write_products`) |
| `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION` | web | Store access through the client credentials grant, for live Apply from the web app |
| `DATABASE_URL` | shopify | Postgres for stored reports and runs (see `apps/shopify/README.md`) |

Live Apply on a development store creates a "Ridgeback 45L Pack" demo product (tagged `centurion-demo`) on first use, then writes the fix to its description. Apply `supabase/migrations/` to a Postgres database (tested on Postgres 16 and Supabase) before running reports in the Shopify app.

## Timeline and prior work

Part of this code predates the hackathon. File and dataset dates are left as they are. This public repository starts from a fresh commit history, so the earlier private commits (the first on Oct 24) are not shown here.

- **Before the hackathon (Oct 23 to 25):** market research, the attribution package and its signature dataset, the gateway MCP server, the shared core, the Shopify app scaffold from Shopify's official template, and the web demo.
- **During the hackathon (Oct 26 to Nov 4):**
  - Shopify app: Run report finished end to end (fetch, classify, store in Postgres, rebuild the screen from stored rows) and compliance webhook configuration.
  - Repository restructured into `apps/` and `packages/`.
  - Nov 3: Shopify app container builds from the repository root; Shopify sessions moved from SQLite to the shared Postgres database.
  - Nov 3: Live store access through the client credentials grant (`getShopifyToken`), replacing pasted tokens in the CLI.
  - Nov 3: **AI Answer Check** with Meta as the primary provider: question builder, deterministic catalog comparison, Meta Model API client (live with `META_API_KEY`), labeled fixtures, stored runs (`answer_checks` table). Replaces the Preview screen in both apps.
  - Nov 3: **Run report in the background**: the run starts and returns at once, throttled pages are retried, one run per store at a time, and a heartbeat fails runs stopped by a restart.
  - Nov 3: **Agent Checkout Test**: a Playwright agent shops a storefront up to checkout and stops, with a payment guard, a video, a pass/slowed/blocked step log and a failure corpus table (`checkout_runs`). Replaces the Preview screen with a real run on a local test page.
  - Nov 3: **Weekly Fix**: one change a week chosen by a fixed rule (the product with the most AI revenue that AI gets a catalog fact wrong about), applied and undone through the Admin API behind an interface (tested against a mocked API), with before/after, holdout products and a difference-in-differences measurement stored in `weekly_fixes`. Meta Muse Spark may reword the explanation only. Live store writes stay off by default. Replaces the last Preview screen.
  - Nov 4: Live Answer Check against Meta's API on a real development store, and a comparer fix so "I don't know" answers count as no answer, with tests from real Muse Spark replies.
  - Nov 4 and 5: **Ask Centurion** on Muse Spark: grounded answers in JSON mode rendered as metrics, charts and tables; in-chat actions (draft, apply and undo the fix on the live store, Answer Check, agent checkout replay, CSV export); voice input; chat history; proactive nudges; in both apps.
  - Nov 4 and 5: Northpine scaled to a mid-market store (60 products, 237 SKUs, 12,000 orders). Web app reskinned and reorganized into AI Revenue (click-to-filter explorer), Fix AI Answers (Answer Check and Weekly Fix merged) and Agent Checkout (animated replay), with a command palette, shortcuts and motion.

## 3-minute demo

Run `cd apps/web && npm install && npm run dev` and open http://localhost:3000. Set `META_API_KEY` in `apps/web/.env.local` for the live chat; add the Shopify variables and `CENTURION_STORE_WRITES=on` for a live Apply.

1. **The problem (0:00 to 0:20).** Shoppers buy through ChatGPT, Perplexity, Gemini and Meta AI. Brands can't see that revenue, don't know what AI says about their products, and can't tell whether an AI agent can check out.
2. **AI Revenue (0:20 to 1:00).** $161,933 from 723 AI orders, each with proof. Click an agent, a week and a product: tiles, trend, journeys and the attribution ledger follow. Open one order's proof. Scroll to **Unattributed signal**: 777 orders look like AI but have no proof, so they are never counted.
3. **Fix AI Answers (1:00 to 1:40).** $35,536 of AI revenue sits on products AI describes wrongly. ChatGPT says the Ridgeback pack weighs 0.9 kg; the catalog says 1.3 kg, with its source. Press **Apply**, show the description in Shopify admin, press **Undo**.
4. **Ask Centurion (1:40 to 2:30).** The corner launcher nudges with a badge. Ask "How is AI revenue trending?" (typed or by voice): Muse Spark answers with key numbers and a chart. Press **Draft this week's fix** and apply it in the chat. Press Ctrl/⌘ K for every shortcut.
5. **Agent Checkout (2:30 to 2:50).** The replay shows an agent stuck on an unlabeled size picker and a popup over checkout, with the fix for each. It is a recorded run on a local test page, labeled as such.
6. **Inside Shopify (2:50 to 3:00).** The Shopify app's Ask Centurion page: the same engine and actions, in Polaris.

## License

No open-source license. All rights reserved, except `apps/shopify/LICENSE.md`, which covers the Shopify template code that app is built from.
