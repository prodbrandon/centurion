# @centurion/web

Standalone version of the Centurion screens, for viewing the product without a Shopify store. By default it runs in demo mode on a fictional store, Northpine Outfitters.

| Screen | Route | Data |
| --- | --- | --- |
| AI Sales | `/` | Real attribution output on 12,000 sample orders across 237 SKUs (`data/demo.json`) |
| Checkout Test | `/checkout-test` | A real run of the checkout agent on its local test page (`packages/core/src/checkout-sample.ts`), labeled as a test-page run |
| Answer Check | `/answer-check` | The real Answer Check pipeline on the Northpine demo catalog. Fixture answers (labeled) unless `META_API_KEY` is set, then Meta Muse Spark answers live |
| Weekly Fix | `/weekly-fix` | The real Weekly Fix rule on the demo data. Apply and undo change a copy in the browser only |

## Commands

```bash
npm install
npm run dev          # http://localhost:3000
npm run build
npm start
npm run typecheck
npm run demo-data    # regenerate data/demo.json from packages/attribution sample orders
```

`data/demo.json` is committed, so the app builds without the attribution package's dependencies installed. A test in `packages/core` fails if it drifts from the classifier's output.

## Modes

| Mode | Set | Shows |
| --- | --- | --- |
| Demo (default) | nothing | `data/demo.json` |
| Live | `CENTURION_SHOP` and `DATABASE_URL` | The latest stored report for that shop, the same rows the Shopify app writes |

Live mode has no authentication. Use it only locally.

## Deploy

On Vercel, set the project root directory to `apps/web`. Demo mode needs no environment variables.
