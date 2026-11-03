// Weekly Fix: the suggestion rule, apply and undo against a mocked Admin API, the write switch,
// measurement, and storage on PGlite.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  applyFix,
  createAnswerProviders,
  DEMO_NORTHPINE_CATALOG,
  DEMO_SALES_SNAPSHOT,
  explainFix,
  latestFix,
  markFixUndone,
  measureFix,
  runAnswerCheck,
  saveAppliedFix,
  shopifyProductAdmin,
  StoreWritesOffError,
  storeWritesEnabled,
  suggestFix,
  undoFix,
  UndoConflictError,
  type AiSalesView,
  type AnswerCheckRun,
  type GraphqlRunner,
  type ProductAdmin,
  type Queryable
} from "../src/server.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const demoView = JSON.parse(readFileSync(resolve(root, "apps/web/data/demo.json"), "utf8")) as AiSalesView;
const fixtureRun = () => runAnswerCheck({ catalog: DEMO_NORTHPINE_CATALOG, providers: createAnswerProviders({}), now: new Date("2026-11-03T12:00:00Z") });

/** An in-memory Admin API that records every call. */
function mockAdmin(descriptions: Record<string, string>) {
  const calls: string[] = [];
  const admin: ProductAdmin = {
    async getDescription(id) {
      calls.push(`get ${id}`);
      if (!(id in descriptions)) throw new Error(`Product ${id} was not found.`);
      return descriptions[id]!;
    },
    async setDescription(id, html) {
      calls.push(`set ${id}`);
      descriptions[id] = html;
    }
  };
  return { admin, calls, descriptions };
}

test("the rule picks the product with the most AI revenue that AI gets wrong, and fixes it with catalog facts", async () => {
  const s = suggestFix({ sales: demoView.report, answerCheck: await fixtureRun(), catalog: DEMO_NORTHPINE_CATALOG })!;
  // Ridgeback ($4,914 from AI) beats the Trailhead jacket ($3,893); the tent sells more but AI gets nothing wrong about it.
  assert.equal(s.productTitle, "Ridgeback 45L Pack");
  assert.equal(s.productId, "NP-RB45");
  assert.equal(s.addition, "Weight: 1.3 kg. Not ultralight.");
  assert.equal(s.evidence.aiRevenue, 4914);
  assert.equal(s.evidence.periodDays, 90);
  assert.deepEqual(s.holdouts, [
    { title: "Basecamp 2P Tent", aiRevenue: 5235 },
    { title: "Trailhead 2 Down Jacket", aiRevenue: 3893 }
  ]);
  assert.equal(s.explanationBy, "template");
  assert.match(s.explanation, /\$4,914 of Ridgeback 45L Pack sales in the last 90 days/);
  assert.match(s.explanation, /ChatGPT told a shopper “It’s an ultralight pack at about 0\.9 kg\.”|ChatGPT told a shopper “It's an ultralight pack at about 0\.9 kg\.”/);
});

test("the demo sales snapshot matches the web demo's report", () => {
  assert.deepEqual(DEMO_SALES_SNAPSHOT, { period: demoView.report.period, top_products: demoView.report.top_products });
});

test("the same inputs always give the same suggestion", async () => {
  const run = await fixtureRun();
  assert.deepEqual(suggestFix({ sales: demoView.report, answerCheck: run, catalog: DEMO_NORTHPINE_CATALOG }), suggestFix({ sales: demoView.report, answerCheck: run, catalog: DEMO_NORTHPINE_CATALOG }));
});

test("no suggestion when AI gets nothing wrong, or when the product isn't selling through AI", async () => {
  const run = await fixtureRun();
  const clean: AnswerCheckRun = { ...run, results: run.results.filter(r => r.status !== "contradiction") };
  assert.equal(suggestFix({ sales: demoView.report, answerCheck: clean, catalog: DEMO_NORTHPINE_CATALOG }), null);
  const noSales: AiSalesView = { ...demoView, report: { ...demoView.report, top_products: [] } };
  assert.equal(suggestFix({ sales: noSales.report, answerCheck: run, catalog: DEMO_NORTHPINE_CATALOG }), null);
});

test("apply adds the text to the top of the description and records before and after; undo restores it", async () => {
  const s = suggestFix({ sales: demoView.report, answerCheck: await fixtureRun(), catalog: DEMO_NORTHPINE_CATALOG })!;
  const { admin, calls, descriptions } = mockAdmin({ "NP-RB45": "<p>A 45-liter pack.</p>" });
  const applied = await applyFix(admin, s, { writesEnabled: true, now: new Date("2026-11-03T12:00:00Z") });
  assert.equal(applied.beforeHtml, "<p>A 45-liter pack.</p>");
  assert.equal(applied.afterHtml, `<p data-centurion-fix="${s.key}">Weight: 1.3 kg. Not ultralight.</p>\n<p>A 45-liter pack.</p>`);
  assert.equal(descriptions["NP-RB45"], applied.afterHtml);
  assert.deepEqual(applied.baseline, { periodDays: 90, product: { title: "Ridgeback 45L Pack", aiRevenue: 4914 }, holdouts: s.holdouts });
  await assert.rejects(applyFix(admin, s, { writesEnabled: true }), /already on the product/);

  await undoFix(admin, applied, { writesEnabled: true });
  assert.equal(descriptions["NP-RB45"], "<p>A 45-liter pack.</p>");
  assert.deepEqual(calls, ["get NP-RB45", "set NP-RB45", "get NP-RB45", "get NP-RB45", "set NP-RB45"]);
});

test("undo refuses to overwrite edits made after the fix", async () => {
  const s = suggestFix({ sales: demoView.report, answerCheck: await fixtureRun(), catalog: DEMO_NORTHPINE_CATALOG })!;
  const { admin, descriptions } = mockAdmin({ "NP-RB45": "<p>Old.</p>" });
  const applied = await applyFix(admin, s, { writesEnabled: true });
  descriptions["NP-RB45"] = `${applied.afterHtml}<p>Merchant added a size chart.</p>`;
  await assert.rejects(undoFix(admin, applied, { writesEnabled: true }), UndoConflictError);
  assert.match(descriptions["NP-RB45"]!, /size chart/);
});

test("with store writes off, apply and undo never touch the Admin API", async () => {
  const s = suggestFix({ sales: demoView.report, answerCheck: await fixtureRun(), catalog: DEMO_NORTHPINE_CATALOG })!;
  const { admin, calls } = mockAdmin({ "NP-RB45": "<p>Old.</p>" });
  await assert.rejects(applyFix(admin, s, { writesEnabled: false }), StoreWritesOffError);
  await assert.rejects(undoFix(admin, { suggestion: s, beforeHtml: "a", afterHtml: "b" }, { writesEnabled: false }), StoreWritesOffError);
  assert.deepEqual(calls, []);
  assert.equal(storeWritesEnabled({}), false);
  assert.equal(storeWritesEnabled({ CENTURION_STORE_WRITES: "true" }), false);
  assert.equal(storeWritesEnabled({ CENTURION_STORE_WRITES: "on" }), true);
});

test("the Shopify Admin client reads descriptionHtml and writes with productUpdate", async () => {
  const sent: { query: string; variables: Record<string, unknown> }[] = [];
  const run: GraphqlRunner = async (query, variables) => {
    sent.push({ query, variables });
    if (query.includes("productUpdate")) return { data: { productUpdate: { product: { id: "gid://shopify/Product/1" }, userErrors: [] } } };
    return { data: { product: { descriptionHtml: "<p>Hi</p>" } } };
  };
  const admin = shopifyProductAdmin(run);
  assert.equal(await admin.getDescription("gid://shopify/Product/1"), "<p>Hi</p>");
  await admin.setDescription("gid://shopify/Product/1", "<p>New</p>");
  assert.deepEqual(sent[1]!.variables, { product: { id: "gid://shopify/Product/1", descriptionHtml: "<p>New</p>" } });

  const rejecting = shopifyProductAdmin(async () => ({ data: { productUpdate: { userErrors: [{ field: ["descriptionHtml"], message: "Too long" }] } } }));
  await assert.rejects(rejecting.setDescription("gid://shopify/Product/1", "x"), /Too long/);
});

test("measurement: the fixed product's change beyond the holdouts' change, per day", () => {
  const baseline = { periodDays: 90, product: { title: "Ridgeback 45L Pack", aiRevenue: 900 }, holdouts: [{ title: "A", aiRevenue: 450 }, { title: "B", aiRevenue: 1350 }] };
  const after = {
    ...demoView,
    report: { ...demoView.report, period: { from: "2026-11-04", to: "2026-11-10" }, top_products: [{ title: "Ridgeback 45L Pack", units: 5, revenue: 140 }, { title: "A", units: 1, revenue: 42 }, { title: "B", units: 2, revenue: 98 }] }
  } as AiSalesView;
  const m = measureFix(baseline, after);
  assert.deepEqual(m.product, { before: 10, after: 20, change: 10 });
  assert.deepEqual(m.holdouts, { before: 10, after: 10, change: 0 });
  assert.equal(m.lift, 10);
});

test("Meta may reword the explanation, but never changes the suggestion, and the template stays on any problem", async () => {
  const s = suggestFix({ sales: demoView.report, answerCheck: await fixtureRun(), catalog: DEMO_NORTHPINE_CATALOG })!;
  assert.deepEqual(await explainFix(s, {}), s, "no key: template");

  const reply = (text: string) => (async () => new Response(JSON.stringify({ completion_message: { content: { type: "text", text } } }), { status: 200 })) as unknown as typeof fetch;
  const good = await explainFix(s, { META_API_KEY: "k" }, { fetch: reply("AI sold $4,914 of the Ridgeback 45L Pack, but told shoppers it weighs 0.9 kg. Your spec says 1.3 kg.") });
  assert.equal(good.explanationBy, "meta");
  assert.deepEqual({ ...good, explanation: s.explanation, explanationBy: "template" }, s, "only the wording changed");

  const dropped = await explainFix(s, { META_API_KEY: "k" }, { fetch: reply("This pack has a problem.") });
  assert.deepEqual(dropped, s, "a rewrite that loses the numbers is ignored");
  const failing = await explainFix(s, { META_API_KEY: "k" }, { fetch: (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch });
  assert.deepEqual(failing, s);
});

async function freshDb(): Promise<Queryable> {
  const pg = new PGlite();
  const dir = resolve(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(resolve(dir, f), "utf8"));
  return { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params as any[])).rows };
}

test("applied fixes are stored with before, after and baseline; undo is recorded; one live copy per fix", async () => {
  const db = await freshDb();
  const shop = { domain: "fix-dev.myshopify.com" };
  const s = suggestFix({ sales: demoView.report, answerCheck: await fixtureRun(), catalog: DEMO_NORTHPINE_CATALOG })!;
  const { admin } = mockAdmin({ "NP-RB45": "<p>Old.</p>" });
  const applied = await applyFix(admin, s, { writesEnabled: true, now: new Date("2026-11-03T12:00:00Z") });
  const id = await saveAppliedFix(db, shop, applied);

  const stored = await latestFix(db, shop.domain);
  assert.deepEqual(stored, { ...applied, id, status: "applied", undoneAt: null });
  await assert.rejects(saveAppliedFix(db, shop, applied), /duplicate key|unique/i);

  assert.equal(await markFixUndone(db, id, new Date("2026-11-04T12:00:00Z")), true);
  assert.equal(await markFixUndone(db, id), false);
  const undone = await latestFix(db, shop.domain);
  assert.equal(undone!.status, "undone");
  assert.equal(undone!.undoneAt, "2026-11-04T12:00:00.000Z");
});
