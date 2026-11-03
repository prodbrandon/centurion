# @centurion/core

Shared data layer for `apps/shopify` and `apps/web`. It builds the AI Sales view in one place and stores report runs in Postgres, so the two apps cannot disagree about a number.

## Entry points

| Import | Safe in the browser | Contents |
| --- | --- | --- |
| `@centurion/core` | Yes | View types, display wording, Preview fixtures |
| `@centurion/core/server` | No | View builder, Postgres store (save run, load latest view, uninstall, redact), Shopify fetch |

The package ships TypeScript source and is compiled by each consumer (Vite, Next.js, tsx). Imports use explicit `.ts` extensions.

## Commands

```bash
npm install
npm test             # includes a Postgres round trip on PGlite
npm run typecheck
```

Set `TEST_DATABASE_URL` to also run the round trip against a real Postgres database.
