# @centurion/core

Shared data layer for `apps/shopify` and `apps/web`. It builds the AI Sales view in one place and stores report runs in Postgres, so the two apps cannot disagree about a number.

## Entry points

| Import | Safe in the browser | Contents |
| --- | --- | --- |
| `@centurion/core` | Yes | View types, display wording, Preview fixtures |
| `@centurion/core/server` | No | View builder, Postgres store (save run, load latest view, uninstall, redact), Shopify fetch, Admin API tokens (`getShopifyToken`) |

`getShopifyToken()` exchanges `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` for an Admin API access token on `SHOPIFY_SHOP` using the client credentials grant, which works for Dev Dashboard apps in the same Shopify organization as the store. Tokens are cached per shop and client ID and refreshed when less than a minute remains. `createShopifyAuth({ fetch, now, env })` builds an independent instance for tests. The file has no dependencies, so `packages/attribution` imports it by relative path.

The package ships TypeScript source and is compiled by each consumer (Vite, Next.js, tsx). Imports use explicit `.ts` extensions.

## Commands

```bash
npm install
npm test             # includes a Postgres round trip on PGlite
npm run typecheck
```

Set `TEST_DATABASE_URL` to also run the round trip against a real Postgres database.
