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
2. Database: apply `../../supabase/migrations/` to a Postgres database and set `DATABASE_URL` in the repo root `.env` (or in `apps/shopify/.env`). Without it the app still loads and shows a "Database not connected" banner.
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

## Known limits

- Sessions are stored in SQLite (`prisma/dev.sqlite`) for local development. Hosted deployments need a shared database for sessions.
- The `Dockerfile` copies only this folder. A container build needs the repository root as its context so `packages/core` and `packages/attribution` are included.
- `customerJourneySummary` parsing has not yet been run against production order data.
