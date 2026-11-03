# @centurion/attribution

Decides which Shopify orders AI assistants sent, records the evidence for each, and maintains the dataset of known AI sources. Used by `packages/core` and both apps.

## Evidence model

Each order is checked against `data/signatures.json` for three kinds of evidence a store owner can verify in Shopify admin:

| Evidence | Example |
| --- | --- |
| Sales channel | The order came through an AI checkout channel |
| Referrer | The visit came from an AI site such as `chatgpt.com` |
| UTM tag | The landing URL carried an AI `utm_source` |

Each match also records the touch: whether AI was the first visit (discovery), the last visit, or both. Direct visits that land straight on a product page are reported separately as "worth watching" and never counted as AI revenue.

There are no model calls in this package. Classification is deterministic and repeatable.

## Commands

```bash
npm install
npm test
npm run sample       # write 90 days of sample orders for a fictional store
npm run report       # plain-language report on the sample

# Live store (Dev Dashboard app with read_orders; see Environment)
SHOPIFY_SHOP=your-store npx tsx src/cli.ts report --days 60

# Grow the signature dataset
npx tsx src/cli.ts discover --input data/sample-orders.json
npx tsx src/cli.ts promote --id mistral --label "Le Chat" --vendor Mistral --host chat.mistral.ai --by <reviewer>
```

`discover` lists unknown referrers and UTM tags that drove orders. `promote` adds an approved source to `data/signatures.json`, recording who approved it and when. Each change bumps the dataset version.

## Environment

| Variable | Meaning |
| --- | --- |
| `SHOPIFY_SHOP` | Store for live fetches, as `your-store` or `your-store.myshopify.com`. `--shop` overrides it |
| `SHOPIFY_CLIENT_ID` | Client ID of a Dev Dashboard app with the `read_orders` scope |
| `SHOPIFY_CLIENT_SECRET` | Client secret of the same app |
| `SHOPIFY_API_VERSION` | Admin API version for live fetches (default `2026-10`) |
| `AI_SIGNATURES` | Alternative path to the signature file |

Live fetches get an Admin API access token through the client credentials grant (`packages/core/src/shopify-auth.ts`). The app must be in the same Shopify organization as the store and installed on it. Tokens last about 24 hours and are refreshed automatically, so a long fetch keeps working across an expiry.

## Known limits

- Clicks from Google AI Overviews and AI Mode look like ordinary Google search in order data.
- The `read_orders` scope returns 60 days of orders. Longer windows need `read_all_orders`.
- The live fetch has not yet been run against production order data.
