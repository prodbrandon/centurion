// Checkout test runs in the failure corpus (checkout_runs), on PGlite with the real migrations.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  checkoutFailureCounts,
  deleteShopData,
  loadLatestCheckoutRun,
  saveCheckoutRun,
  TEST_PAGE_CHECKOUT_RUN,
  type CheckoutRunResult,
  type Queryable
} from "../src/server.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function freshDb(): Promise<Queryable> {
  const pg = new PGlite();
  const dir = resolve(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(resolve(dir, f), "utf8"));
  return { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params as any[])).rows };
}

const blockedRun = (at: string, step: string): CheckoutRunResult => ({
  ...TEST_PAGE_CHECKOUT_RUN,
  target: { url: "https://store.example", kind: "storefront" },
  startedAt: at,
  finishedAt: at,
  result: "blocked",
  failedStep: 2,
  problems: 1,
  steps: [
    { ...TEST_PAGE_CHECKOUT_RUN.steps[0]! },
    { n: 2, title: step, status: "blocked", detail: "Stopped.", ms: 10, url: "https://store.example" }
  ]
});

test("saving a run for an uninstalled shop does not re-install it", async () => {
  const db = await freshDb();
  await db.query(`insert into shops (shop_domain, uninstalled_at) values ('gone.myshopify.com', now())`);
  await saveCheckoutRun(db, { shop: { domain: "gone.myshopify.com" }, run: blockedRun("2026-11-02T00:00:00.000Z", "Add to cart") });
  const [row] = await db.query<{ uninstalled_at: unknown }>(`select uninstalled_at from shops where shop_domain = 'gone.myshopify.com'`);
  assert.ok(row!.uninstalled_at, "still uninstalled");
  assert.equal(await loadLatestCheckoutRun(db, "gone.myshopify.com"), null, "and its runs stay hidden");
});

test("the committed sample is a test-page run that reached checkout without a payment request", () => {
  assert.equal(TEST_PAGE_CHECKOUT_RUN.target.kind, "test_page");
  assert.equal(TEST_PAGE_CHECKOUT_RUN.result, "reached_checkout");
  assert.deepEqual(TEST_PAGE_CHECKOUT_RUN.blockedRequests, []);
  assert.equal(TEST_PAGE_CHECKOUT_RUN.steps.at(-1)!.title, "Reach checkout");
  assert.equal(TEST_PAGE_CHECKOUT_RUN.videoPath, null);
});

test("checkout runs round-trip, test-page runs stay separate from shops, and the corpus counts failures", async () => {
  const db = await freshDb();
  const shop = { domain: "corpus-dev.myshopify.com" };
  assert.equal(await loadLatestCheckoutRun(db, null), null);

  await saveCheckoutRun(db, { shop: null, run: TEST_PAGE_CHECKOUT_RUN });
  const older = blockedRun("2026-11-01T00:00:00.000Z", "Add to cart");
  const newer = blockedRun("2026-11-02T00:00:00.000Z", "Go to the cart");
  await saveCheckoutRun(db, { shop, run: older });
  await saveCheckoutRun(db, { shop, run: newer });
  await saveCheckoutRun(db, { shop: { domain: "other.myshopify.com" }, run: blockedRun("2026-11-02T00:00:00.000Z", "Add to cart") });

  assert.deepEqual(await loadLatestCheckoutRun(db, null), TEST_PAGE_CHECKOUT_RUN);
  assert.deepEqual(await loadLatestCheckoutRun(db, shop.domain), newer);
  assert.deepEqual(await checkoutFailureCounts(db), [
    { failureKind: "Add to cart", runs: 2 },
    { failureKind: "Go to the cart", runs: 1 }
  ]);
  const [row] = await db.query<{ failed_step: number; failure_kind: string; video_path: string | null }>(
    `select failed_step, failure_kind, video_path from checkout_runs c join shops s on s.id = c.shop_id where s.shop_domain = $1 order by started_at desc limit 1`,
    [shop.domain]
  );
  assert.deepEqual(row, { failed_step: 2, failure_kind: "Go to the cart", video_path: null });

  await deleteShopData(db, shop.domain);
  assert.equal(await loadLatestCheckoutRun(db, shop.domain), null);
  assert.deepEqual(await loadLatestCheckoutRun(db, null), TEST_PAGE_CHECKOUT_RUN, "test-page runs belong to no shop");
});
