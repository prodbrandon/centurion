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

# Live store (custom app token with read_orders)
npx tsx src/cli.ts report --shop your-store.myshopify.com --token <admin-api-token> --days 60

# Grow the signature dataset
npx tsx src/cli.ts discover --input data/sample-orders.json
npx tsx src/cli.ts promote --id mistral --label "Le Chat" --vendor Mistral --host chat.mistral.ai --by <reviewer>
```

`discover` lists unknown referrers and UTM tags that drove orders. `promote` adds an approved source to `data/signatures.json`, recording who approved it and when. Each change bumps the dataset version.

## Environment

| Variable | Meaning |
| --- | --- |
| `AI_SIGNATURES` | Alternative path to the signature file |
| `SHOPIFY_API_VERSION` | Admin API version for live fetches |

## Known limits

- Clicks from Google AI Overviews and AI Mode look like ordinary Google search in order data.
- The `read_orders` scope returns 60 days of orders. Longer windows need `read_all_orders`.
- The live fetch has not yet been run against production order data.
