# @centurion/checkout-test

Agent Checkout Test. A shopping agent opens a storefront in Chromium, finds a product, chooses its options, adds it to the cart and goes to checkout, then stops. It records a video and a step log, and marks each step passed, slowed (it got through, with trouble) or blocked (it stopped there), with a fix for the store.

**It never pays.** It never types into payment fields and it stops as soon as checkout opens. A request guard aborts any request, GET included, to a payment-like path (`/pay`, `/payments/…`, `/checkouts/…/processing` and similar, matched on whole path segments, never on the host or query). From the moment the agent clicks the checkout button it also aborts every write except the plain cart endpoints (`/cart`, `/cart/add`, `/cart/change`, `/cart/update`) that Shopify themes use to open checkout, so nothing a checkout page sends while loading gets through. Tests prove it against stores whose checkout button posts to `/pay`, links to `GET /pay`, posts a form to `/checkout`, or whose checkout page fires order requests while loading.

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
| `src/test-store.ts` | Local practice store with switchable flaws (popup, unlabeled size picker, no search, no add-to-cart, silent add-to-cart, and hostile checkout buttons and pages) |
| `src/cli.ts` | Command line runner |

## Known limits

- Scripted agent: it handles common theme markup (search box, product links, `select` pickers, "Add to cart", "Check out"). Swatch buttons and custom pickers are not chosen yet.
- Runs locally or wherever Chromium is available. The Shopify app shows stored runs; it does not start a browser itself.
