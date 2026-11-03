// Runs the same round trip as sync.test.ts through postgres.js against a real Postgres, because
// PGlite and postgres.js pass parameters differently (postgres.js re-encodes JSON for jsonb params).
// Opt-in: TEST_DATABASE_URL=postgresql://... npm test
// Uses a throwaway shop domain and deletes it afterwards. The migration must already be applied.
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Order } from "../../attribution/src/types.ts";
import { buildView, currentSignatures, deleteShopData, loadLatestView, postgresDb, redactOrders, saveReportRun } from "../src/server.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

test("db.ts never sends a bare $n::jsonb parameter", () => {
  const src = readFileSync(resolve(here, "../src/db.ts"), "utf8");
  const bad = src.match(/\$\d+::jsonb/g) ?? [];
  assert.deepEqual(bad, [], "use $n::text::jsonb; postgres.js double-encodes JSON for jsonb params");
});

const url = process.env.TEST_DATABASE_URL;

test("round trip through postgres.js on a real Postgres", { skip: url ? false : "set TEST_DATABASE_URL to run" }, async () => {
  const db = postgresDb(url!);
  const shop = { domain: `test-${randomUUID().slice(0, 8)}.myshopify.com`, name: "Centurion test", currency: "USD", scopes: ["read_orders"] };
  const orders: Order[] = JSON.parse(readFileSync(resolve(root, "packages/attribution/data/sample-orders.json"), "utf8")).slice(0, 200);
  const now = new Date("2026-10-23T12:00:00Z");
  try {
    await saveReportRun(db, { shop, orders, days: 90, now });
    const loaded = await loadLatestView(db, shop.domain);
    const direct = buildView({ orders, file: currentSignatures, store: { name: shop.name, domain: shop.domain }, generatedAt: now.toISOString() });
    assert.deepEqual(loaded, direct);

    const [row] = await db.query<{ scopes: string[] }>(`select scopes from shops where shop_domain = $1`, [shop.domain]);
    assert.deepEqual(row!.scopes, ["read_orders"]);
    assert.equal(await redactOrders(db, shop.domain, [orders[0]!.id]), 1);

    // An empty store (a fresh dev store) must also work.
    await saveReportRun(db, { shop, orders: [], days: 60, now: new Date(now.getTime() + 1000) });
    assert.equal((await loadLatestView(db, shop.domain))!.report.orders, 0);
  } finally {
    await deleteShopData(db, shop.domain);
  }
});
