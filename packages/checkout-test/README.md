# @centurion/checkout-test

Agent Checkout Test. A shopping agent opens a storefront in Chromium, finds a product, chooses its options, adds it to the cart and goes to checkout, then stops. It records a video and a step log, and marks each step passed, slowed (it got through, with trouble) or blocked (it stopped there), with a fix for the store.

**It never pays.** It never types into payment fields, it stops as soon as checkout loads, and a request guard aborts any non-GET request to a payment-like URL, and every non-GET request once checkout is reached, whatever the page's buttons do. A test proves the guard holds against a store whose checkout button posts straight to `/pay`.

The v0 agent is scripted (Playwright locators by role and text), with no model.

## Commands

```bash
npm install
npm test                 # runs the agent in headless Chromium against the local test store
npm run typecheck
npm run test-page        # one run on the local test store, with a popup and an unlabeled size picker switched on
npm run test-page -- --clean
npm run check -- --url https://your-store.example --shop your-shop.myshopify.com --query "jacket"
```

Options: `--video-dir <dir>` (default `./videos`), `--no-video`, `--write-sample <file>`. Videos are `.webm` files and are never committed. With `DATABASE_URL` set, each run is stored in `checkout_runs` (migration `supabase/migrations/20261103030000_checkout_runs.sql`): the failure corpus of which steps block agents. Test-page runs are stored without a shop.

`packages/core/src/checkout-sample.ts` is a real test-page run, regenerated with:

```bash
npm run test-page -- --write-sample ../core/src/checkout-sample.ts --no-video
```

## Files

| File | What it does |
| --- | --- |
| `src/agent.ts` | The worker: steps, payment guard, video |
| `src/test-store.ts` | Local practice store with switchable flaws (popup, unlabeled size picker, no search, no add-to-cart, checkout button that posts to `/pay`) |
| `src/cli.ts` | Command line runner |

## Known limits

- Scripted agent: it handles common theme markup (search box, product links, `select` pickers, "Add to cart", "Check out"). Swatch buttons and custom pickers are not chosen yet.
- Runs locally or wherever Chromium is available. The Shopify app shows stored runs; it does not start a browser itself.
