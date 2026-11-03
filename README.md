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
| `apps/shopify` | **AI Sales** works end to end. **Answer Check** asks Meta Llama about the store and checks every answer against the catalog (labeled fixture answers until `META_API_KEY` is set). Checkout Test and Weekly Fix are labeled Preview and show sample data. |
| `apps/web` | Demo mode renders real attribution output on 1,500 sample orders, and the real Answer Check pipeline on the demo catalog (fixture answers, labeled). Other screens are labeled Preview. |
| `apps/gateway` | Working MCP server on sample data with development tokens. Not part of the first release. |
| `packages/attribution` | Classifier, report and signature dataset tooling, with tests. Live Shopify fetch not yet run against production order data. |
| `packages/core` | View builder and Postgres store, with a round-trip test on an in-process Postgres (PGlite). |

## Where we use Meta AI

**AI Answer Check runs on Meta Llama.** It asks Llama the questions shoppers ask about a store's best sellers and policies ("Is the Trailhead 2 jacket waterproof?", "What's the return window?"), then checks every answer against the store's own catalog and shows each contradiction with the catalog fact and its source.

- **The Meta call is built and tested, and runs on fixtures until API credits are added.** `packages/core/src/answer-check/providers.ts` calls the Llama API (`POST https://api.llama.com/v1/chat/completions`, default model `Llama-4-Maverick-17B-128E-Instruct-FP8`). Setting `META_API_KEY` switches it from labeled sample answers to live Llama answers, with no code change. Until then, both apps show a "Fixture data" banner and tag every sample answer with the assistant it stands in for.
- **Llama answers; it never judges.** Deciding whether an answer is right is plain code (`compare.ts`): banned claims, numbers with units, prices and stock, each traced to a catalog fact. The same answer always gets the same verdict.
- **Revenue never touches a model.** AI Sales attribution stays deterministic, as in the design rules above.
- ChatGPT, Perplexity and Gemini appear in the fixture run as labeled samples only. Meta is the only live provider built so far.

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
cp .env.example apps/shopify/.env    # set DATABASE_URL; see apps/shopify/README.md for the database setup
cd apps/shopify && npm install && shopify app dev
```

Apply `supabase/migrations/` to a Postgres database (tested on Postgres 16 and Supabase) before running a report. See each package's README for details.

## Timeline and prior work

Part of this code predates the hackathon. File and dataset dates are left as they are. This public repository starts from a fresh commit history, so the earlier private commits (the first on Oct 24) are not shown here.

- **Before the hackathon (Oct 23 to 25):** market research, the attribution package and its signature dataset, the gateway MCP server, the shared core, the Shopify app scaffold from Shopify's official template, and the web demo.
- **During the hackathon (Oct 26 to Nov 4):**
  - Shopify app: Run report finished end to end (fetch, classify, store in Postgres, rebuild the screen from stored rows) and compliance webhook configuration.
  - Repository restructured into `apps/` and `packages/`.
  - Nov 3: Shopify app container builds from the repository root; Shopify sessions moved from SQLite to the shared Postgres database.
  - Nov 3: Live store access through the client credentials grant (`getShopifyToken`), replacing pasted tokens in the CLI.
  - Nov 3: **AI Answer Check** with Meta Llama as the primary provider: question builder, deterministic catalog comparison, Llama API client (live with `META_API_KEY`), labeled fixtures, stored runs (`answer_checks` table). Replaces the Preview screen in both apps.

## 3-minute demo

Everything below runs locally with no accounts: `cd apps/web && npm install && npm run dev`, then open http://localhost:3000.

1. **The problem (0:00 to 0:20).** Shoppers now ask ChatGPT, Perplexity and Gemini what to buy. Store owners can't see which sales came from those assistants, or what the assistants are telling shoppers about their products.
2. **AI Sales (0:20 to 1:10), `/`.** Northpine Outfitters is a fictional store with 1,500 sample orders. The engine finds 99 AI-sent orders worth $18,861 (6.5% of revenue) and splits them by assistant and by path (found through AI vs came back through AI). Scroll to **Every AI order, with proof**: each order shows the exact signal that matched (an AI referrer, a `utm_source`, or an AI sales channel). Point out **Not counted, but worth watching**: likely AI visits without proof are never counted as revenue.
3. **AI Answer Check (1:10 to 2:15), `/answer-check`.** This is the Meta Llama feature. Read the yellow **Fixture data** label first: no Llama key is set yet, so the answers are written samples tagged with the assistant they stand in for. The check itself is real. Show the first finding: an assistant calls the Trailhead 2 jacket "fully waterproof", the catalog says "DWR-coated shell, not waterproof" with the lab-results source, and the claim is on the store's banned list. Then the pack: "ultralight at about 0.9 kg" is caught twice, once as a banned claim and once as a wrong weight (1.3 kg), across units. Scroll to **Every answer** to show answers that passed, including "water resistant, not waterproof". Say plainly: with `META_API_KEY` set, the same screen shows live Llama answers, and no model decides what's wrong.
4. **Checkout Test and Weekly Fix (2:15 to 2:45).** Both are labeled Preview. Checkout Test shows an agent shopping the store and where it got stuck. Weekly Fix shows the one change suggested this week, with apply, undo and holdout products for measuring it.
5. **Inside Shopify (2:45 to 3:00).** The same screens run as an embedded Shopify admin app (`apps/shopify`), built from the same `packages/core` code, so the numbers can't drift. AI Sales runs live on a store's orders; Answer Check asks Llama about the store's own products once a key is set.

## License

No open-source license. All rights reserved, except `apps/shopify/LICENSE.md`, which covers the Shopify template code that app is built from.
