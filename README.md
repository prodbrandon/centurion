# Centurion

Centurion shows a Shopify store which of its sales came from AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Claude), with the evidence for every order. The goal is to then make one small, measured change to the store each week so AI sends more.

Built for the Meta Global AI Hackathon, Indie Dev track, "Build Your World" (Oct 26 to Nov 4, 2026).

## Design rules

- **Attribution is deterministic.** No language model decides which orders count or how much revenue AI sent. Every number traces back to an order ID and the signal that matched.
- **No overclaiming.** A direct visit to a product page is reported as "worth watching", never as AI revenue.
- **Official APIs only.** AI answers are read through model provider APIs, never by scraping chat interfaces.

## Repository layout

```
apps/
  shopify/        Embedded Shopify admin app (the product)
  web/            Standalone demo on a fictional store, no Shopify account needed
  gateway/        MCP server that answers outside AI agents with a brand's verified facts
packages/
  attribution/    Order classifier, AI source signatures, reports and CLI
  core/           Shared view builder and Postgres store used by both apps
supabase/
  migrations/     Postgres schema
```

| Package | Status |
| --- | --- |
| `apps/shopify` | **AI Sales** works end to end. Checkout Test, Answer Check and Weekly Fix are labeled Preview and show sample data. |
| `apps/web` | Demo mode renders real attribution output on 1,500 sample orders. Other screens are labeled Preview. |
| `apps/gateway` | Working MCP server on sample data with development tokens. Not part of the first release. |
| `packages/attribution` | Classifier, report and signature dataset tooling, with tests. Live Shopify fetch not yet run against production order data. |
| `packages/core` | View builder and Postgres store, with a round-trip test on an in-process Postgres (PGlite). |

## How AI Sales works

1. The merchant presses **Run report** in Shopify admin.
2. The app reads the last 60 days of orders through the Admin GraphQL API (`read_orders`), including each order's first and last visit from `customerJourneySummary`.
3. `packages/attribution` matches each order against the signature dataset (`packages/attribution/data/signatures.json`) and records the evidence: an AI sales channel, an AI referrer, or an AI UTM tag, plus whether AI was the first touch, the last touch, or both.
4. The run is saved to Postgres, and the screen is rebuilt from the stored rows.

## Getting started

Requires Node 22.12 or newer. Each package installs on its own; shared code is linked with `file:` dependencies.

```bash
# Attribution: tests and a report on sample data
cd packages/attribution && npm install && npm test && npm run report

# Core: tests, including a Postgres round trip on PGlite
cd packages/core && npm install && npm test

# Web demo, no accounts needed (http://localhost:3000)
cd apps/web && npm install && npm run dev

# Shopify app: needs a Shopify Partner account, a development store and Shopify CLI 5.0+
cp .env.example .env    # set DATABASE_URL
cd apps/shopify && npm install && shopify app dev
```

Apply `supabase/migrations/` to a Postgres database (tested on Postgres 16 and Supabase) before running a report. See each package's README for details.

## Timeline and prior work

Part of this code predates the hackathon. File and dataset dates are left as they are. This public repository starts from a fresh commit history, so the earlier private commits (the first on Oct 24) are not shown here.

- **Before the hackathon (Oct 23 to 25):** market research, the attribution package and its signature dataset, the gateway MCP server, the shared core, the Shopify app scaffold from Shopify's official template, and the web demo.
- **During the hackathon (Oct 26 to Nov 4):**
  - Shopify app: Run report finished end to end (fetch, classify, store in Postgres, rebuild the screen from stored rows) and compliance webhook configuration.
  - Repository restructured into `apps/` and `packages/`.

## License

No open-source license. All rights reserved, except `apps/shopify/LICENSE.md`, which covers the Shopify template code that app is built from.
