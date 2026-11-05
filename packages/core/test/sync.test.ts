// Proves the two apps stay in sync: a view read back from Postgres is identical to the view
// the engine builds directly, and the web app's committed demo data matches the engine.
// Runs the real migrations on PGlite (Postgres compiled to WASM, in process).
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { Order } from "../../attribution/src/types.ts";
import {
  buildView,
  currentSignatures,
  deleteShopData,
  loadLatestView,
  markShopUninstalled,
  redactOrders,
  saveReportRun,
  type Db,
  type Queryable
} from "../src/server.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sampleOrders: Order[] = JSON.parse(readFileSync(resolve(root, "packages/attribution/data/sample-orders.json"), "utf8"));
const migrationsDir = resolve(root, "supabase/migrations");
const migrations = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort().map(f => readFileSync(resolve(migrationsDir, f), "utf8"));
const SHOP = { domain: "northpine-dev.myshopify.com", name: "Northpine Outfitters", currency: "USD", scopes: ["read_orders"] };
const NOW = new Date("2026-10-23T12:00:00Z");

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  for (const sql of migrations) await pg.exec(sql);
  const wrap = (t: { query: PGlite["query"] }): Queryable => ({
    query: async <T>(text: string, params: unknown[] = []) => (await t.query<T>(text, params as any[])).rows
  });
  return { ...wrap(pg), transaction: fn => pg.transaction(tx => fn(wrap(tx))) };
}

const count = async (db: Queryable, table: string) => Number((await db.query<{ n: number }>(`select count(*)::int as n from ${table}`))[0]!.n);

test("a report read back from Postgres equals the engine's direct output", async () => {
  const db = await freshDb();
  const { view: saved } = await saveReportRun(db, { shop: SHOP, orders: sampleOrders, days: 90, now: NOW });
  const loaded = await loadLatestView(db, SHOP.domain);
  const direct = buildView({ orders: sampleOrders, file: currentSignatures, store: { name: SHOP.name, domain: SHOP.domain }, generatedAt: NOW.toISOString() });

  assert.deepEqual(loaded, direct);
  assert.deepEqual(saved, direct);
  assert.equal(direct.report.ai.orders, 723);
  assert.equal(await count(db, "orders"), 12000);
  assert.equal(await count(db, "attributions"), 12000);
});

test("Shopify-style timestamps and totals give the same view after a round trip", async () => {
  const db = await freshDb();
  const orders: Order[] = [
    { id: "gid://shopify/Order/2", name: "#1002", createdAt: "2026-10-20T10:00:00Z", total: 120.5, currency: "USD", channel: "Online Store",
      firstVisit: { referrerUrl: "https://chatgpt.com/", landingPage: "/products/a" }, lastVisit: null, lineItems: [{ title: "A", sku: null, quantity: 1, total: 120.5 }] },
    { id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-10-20T10:00:00Z", total: 80, currency: "USD", channel: "ChatGPT",
      firstVisit: null, lastVisit: null, lineItems: [{ title: "B", quantity: 2, total: 80 }] }
  ];
  await saveReportRun(db, { shop: SHOP, orders, days: 60, now: NOW });
  const loaded = await loadLatestView(db, SHOP.domain);
  const direct = buildView({ orders, file: currentSignatures, store: { name: SHOP.name, domain: SHOP.domain }, generatedAt: NOW.toISOString() });
  assert.deepEqual(loaded, direct);
  assert.equal(loaded!.aiOrders.length, 2);
});

test("re-running upserts orders, and the latest run wins", async () => {
  const db = await freshDb();
  await saveReportRun(db, { shop: SHOP, orders: sampleOrders.slice(0, 100), days: 90, now: NOW });
  const later = new Date(NOW.getTime() + 864e5);
  await saveReportRun(db, { shop: SHOP, orders: sampleOrders, days: 90, now: later });
  assert.equal(await count(db, "orders"), 12000);
  assert.equal(await count(db, "runs"), 2);
  const loaded = await loadLatestView(db, SHOP.domain);
  assert.equal(loaded!.report.orders, 12000);
  assert.equal(loaded!.generatedAt, later.toISOString());
});

test("uninstall hides data, shop redact deletes it, customer redact deletes orders", async () => {
  const db = await freshDb();
  await saveReportRun(db, { shop: SHOP, orders: sampleOrders, days: 90, now: NOW });

  const removed = await redactOrders(db, SHOP.domain, [100463, "gid://shopify/Order/100374"]);
  assert.equal(removed, 2);
  assert.equal(await count(db, "attributions"), 11998);

  await markShopUninstalled(db, SHOP.domain);
  assert.equal(await loadLatestView(db, SHOP.domain), null);

  await deleteShopData(db, SHOP.domain);
  for (const t of ["shops", "runs", "orders", "attributions"]) assert.equal(await count(db, t), 0, t);
});

test("unknown shop has no view", async () => {
  assert.equal(await loadLatestView(await freshDb(), "nobody.myshopify.com"), null);
});

test("web demo data is the engine's current output", () => {
  const demo = JSON.parse(readFileSync(resolve(root, "apps/web/data/demo.json"), "utf8"));
  const direct = buildView({ orders: sampleOrders, file: currentSignatures, store: demo.store, generatedAt: demo.generatedAt });
  assert.deepEqual(demo, direct, "run `npm run demo-data` in apps/web/ and commit apps/web/data/demo.json");
});
