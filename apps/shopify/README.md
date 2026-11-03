# @centurion/shopify

Embedded Shopify admin app. Built on Shopify's React Router app template with Polaris web components and App Bridge.

All classification and storage goes through `@centurion/core` (`packages/core`), the same code the web demo uses, so both surfaces produce identical numbers from the same rows.

## Screens

| Screen | Route | Data |
| --- | --- | --- |
| AI Sales | `/app` | Live. **Run report** starts a background run that fetches the last 60 days of orders (retrying throttled pages), classifies them and stores the run in Postgres. The screen shows the run's progress and renders the result when it is done. |
| Checkout Test | `/app/checkout-test` | The store's latest checkout agent run from `checkout_runs`, run with `packages/checkout-test`. Until the store is tested it shows the latest test-page run, labeled as such. |
| Answer Check | `/app/answer-check` | Live with `META_API_KEY`: **Ask Meta Llama now** asks Llama about the store's products (AI best sellers first), compares each answer with the catalog by fixed rules and stores the run. Without a key it shows a fixture run on the Northpine demo catalog, labeled as sample answers. |
| Weekly Fix | `/app/weekly-fix` | Chooses this store's fix from its stored AI Sales report, its latest live Answer Check and its catalog, by a fixed rule. Apply and undo use the Admin API (`productUpdate`) and record before/after and holdouts in `weekly_fixes`; they stay disabled until `CENTURION_STORE_WRITES=on` and `write_products` are set. With no fix for the store, it shows the rule's result on the demo store, labeled. |

## Webhooks

| Topic | Behavior |
| --- | --- |
| `app/uninstalled` | Hides the shop's data |
| `shop/redact` | Deletes the shop's data |
| `customers/redact` | Deletes the listed orders |
| `customers/data_request` | Logged. No customer PII is stored. |
| `app/scopes_update` | Updates the stored session scope |

## Setup

1. Install the shared packages, then this app:
   ```bash
   (cd ../../packages/attribution && npm install)
   (cd ../../packages/core && npm install)
   npm install
   ```
2. Database: set `DATABASE_URL` in `apps/shopify/.env`. Shopify sessions are stored in the same Postgres database as the Centurion tables, in a `Session` table managed by Prisma (`prisma/schema.prisma`, `prisma/migrations/`). On Supabase, use the direct connection or the session pooler (port 5432) here: Prisma migrations don't run through the transaction pooler.
   - **Empty database:** run `npx prisma migrate deploy` first, then apply `../../supabase/migrations/` in filename order.
   - **Database that already has the Centurion tables** (Prisma refuses to migrate a non-empty database it hasn't seen before, error P3005): create the `Session` table and record its migration as applied once:
     ```bash
     npx prisma db execute --file prisma/migrations/20261103000000_create_session_table/migration.sql --schema prisma/schema.prisma
     npx prisma migrate resolve --applied 20261103000000_create_session_table
     ```
   After that, `prisma migrate deploy` (run by `shopify app dev` and on container start) only applies new session migrations.
3. Install Shopify CLI 5.0 or newer globally (`npm install -g @shopify/cli@latest`). Then link your own app and development store:
   ```bash
   shopify app config link
   shopify app dev
   ```
   Press `p` to open the app in your development store and approve the `read_orders` and `read_products` scopes.
4. In the Partner Dashboard, request **Protected customer data access** (level 1, no PII fields) under the app's API access settings. Shopify can refuse order reads without it.

## Commands

```bash
shopify app dev          # tunnel, app URL, hot reload
npm run typecheck
npm run lint
npm run build
```

To see AI Sales populate in development, create test orders whose landing URL carries an AI referrer or `utm_source=chatgpt.com`, then press **Run report**.

## Container

The image is built from the repository root, so `packages/core` and `packages/attribution` are in the build context:

```bash
# from the repository root
docker build -f apps/shopify/Dockerfile -t centurion-shopify .
docker run -p 3000:3000 --env-file apps/shopify/.env centurion-shopify
```

On start the container runs `prisma generate && prisma migrate deploy` (prepare the database as in Setup step 2 first), then serves the app on port 3000. It needs `DATABASE_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL` and `SCOPES`.

## Answer Check setup

- `META_API_KEY`: a Llama API key. When it is set, Answer Check calls Meta Llama live; nothing else changes. Optional `META_MODEL` (default `Llama-4-Maverick-17B-128E-Instruct-FP8`) and `META_API_BASE_URL` (default `https://api.llama.com/v1`).
- Banned and approved claims per product come from the product metafields `centurion.prohibited_claims` and `centurion.approved_claims` (a list of single-line text, or comma-separated text). Spec facts come from `centurion.facts`, a JSON metafield such as `{"weight": "1.3 kg", "material": "100% merino wool"}`. Prices and stock come from the product itself.
- Apply `../../supabase/migrations/20261103010000_answer_checks.sql`. Live runs are stored in `answer_checks`; fixture runs are never stored.

## Known limits

- Report runs execute in the app's Node process, one at a time per store (a second **Run report** follows the run already going). A running report records a heartbeat as pages arrive; if the process restarts mid-run, the run is marked failed once it has made no progress for 10 minutes, and can be started again. Run a single instance, or move runs to a queue before scaling out. Apply `../../supabase/migrations/20261103020000_report_run_heartbeat.sql`.
- Answer Check on a live store checks prices, stock, banned claims and the spec facts in `centurion.facts`. Store policies are only checked on the demo catalog until they are read from Shopify.
- Weekly Fix on a live store acts on the spec facts in `centurion.facts`. A store without them gets no fix and sees the demo example.
- Answer Check runs inside the request (5 products, 3 questions each, 3 at a time), so expect it to take tens of seconds.

- `customerJourneySummary` parsing has not yet been run against production order data.
