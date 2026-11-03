# @centurion/gateway

The agent-facing side of a brand's rulebook. Outside AI agents (shopping assistants, personal agents, buyer agents in Coupa, Zip or Copilot) connect over MCP and get what the brand allows their tier to get, no more. Every call is written to a hash-chained evidence log.

Sample data is a fictional brand, Northpine Outfitters, in `data/rulebook.json`.

## Tools

| Tool | What it does | Tiers |
| --- | --- | --- |
| `brand_get_agent_terms` | What the calling agent may read and do, and its order limit | all |
| `brand_search_products` | Paginated catalog search | all |
| `brand_get_product_facts` | Verified facts with source and date, plus approved and prohibited claims | all |
| `brand_check_claim` | Approved / prohibited / unverified verdict before an agent states a claim | all |
| `brand_get_policies` | Returns, shipping, warranty with sources | all |
| `brand_get_offers` | Offers for the caller's tier, based only on loyalty or published promotions | verified_agent, linked_member |
| `brand_get_order_status` | The linked shopper's own order, with return eligibility | linked_member |
| `brand_start_return` | Starts a return in the 60-day window; idempotent per order and SKU | linked_member |
| `brand_request_wholesale_quote` | Price list, MOQ check, discount ceiling, agent spend limit | wholesale_account |

## Tiers

`anonymous` → `verified_agent` (Web Bot Auth, Visa TAP, Mastercard Agent Pay) → `linked_member` (shopper linked a loyalty account via OAuth / UCP Identity Linking) → `wholesale_account` (approved retailer). Tiers and their permissions live in the rulebook, not in code.

## Run

```bash
npm install
npm run build
npm run smoke          # self-check across three tiers + evidence chain verification

# stdio, as a linked member's agent
BRAND_AGENT_TIER=linked_member BRAND_SUBJECT=member_123 node dist/index.js

# Streamable HTTP with dev bearer tokens (tier and subject travel as token scopes)
TRANSPORT=http PORT=3000 \
DEV_TOKENS="tokA=chatgpt-shopping:verified_agent;tokB=member-agent:linked_member:member_123" \
node dist/index.js

npx @modelcontextprotocol/inspector node dist/index.js   # interactive testing
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `BRAND_RULEBOOK` | `data/rulebook.json` | Rulebook path |
| `EVIDENCE_LOG` | `evidence.jsonl` | Append-only evidence log |
| `EVIDENCE_SECRET` | dev value | HMAC key for the chain. Set a real secret in any shared environment |
| `BRAND_AGENT_ID`, `BRAND_AGENT_TIER`, `BRAND_SUBJECT` | `local-agent`, `anonymous`, none | Caller identity on stdio |
| `BRAND_TODAY` | today | Fixed date for tests |
| `TRANSPORT`, `PORT`, `PUBLIC_URL`, `DEV_TOKENS` | stdio, 3000 | HTTP mode |

## Known limits

- `DEV_TOKENS` is a stand-in. Replace with JWT verification against a real authorization server, and map Web Bot Auth / TAP signals to tiers at the edge.
- Orders, returns and quotes read from the JSON file. Real versions call Shopify (or the custom stack), the returns app and the ERP through their own connectors.
- Claim matching is substring-based.
- Calls rejected by schema validation never reach a handler, so they are not in the evidence log. Add a transport-level logger if every attempt must be recorded.
- Evidence entries are HMAC-chained, not yet signed as AP2-style mandates.
