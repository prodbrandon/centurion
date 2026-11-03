# @centurion/shopify

Embedded Shopify admin app. Built on Shopify's React Router app template with Polaris web components and App Bridge.

All classification and storage goes through `@centurion/core` (`packages/core`), the same code the web demo uses, so both surfaces produce identical numbers from the same rows.

## Screens

| Screen | Route | Data |
| --- | --- | --- |
| AI Sales | `/app` | Live. **Run report** fetches the last 60 days of orders, classifies them, stores the run in Postgres and renders it. |
| Checkout Test | `/app/checkout-test` | Preview, sample data |
| Answer Check | `/app/answer-check` | Preview, sample data |
| Weekly Fix | `/app/weekly-fix` | Preview. Apply and undo do not change the store. |

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
   Press `p` to open the app in your development store and approve the `read_orders` scope.
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

## Known limits

- `customerJourneySummary` parsing has not yet been run against production order data.
