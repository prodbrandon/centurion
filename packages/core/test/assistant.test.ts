import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { parseRichReply, storeBriefing } from "../src/assistant.ts";
import type { AiSalesView } from "../src/types.ts";

const view = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../apps/web/data/demo.json"), "utf8")) as AiSalesView;
const ctx = { view, demo: true, screen: "AI Sales" };

test("a rich reply takes chart values from the data, never from the model", () => {
  const r = parseRichReply(
    JSON.stringify({ headline: "ChatGPT leads.", metrics: [{ label: "AI revenue", value: "$161,933" }], chart: "revenue_by_assistant", actions: ["draft_fix", "export_ai_orders"] }),
    ctx
  );
  assert.equal(r.headline, "ChatGPT leads.");
  assert.deepEqual(r.chart!.points[0], { label: "ChatGPT", value: view.report.by_source[0]!.revenue });
  assert.deepEqual(r.actions.map(a => a.id), ["draft_fix", "export_ai_orders"]);
});

test("unknown datasets and actions are dropped, sizes are capped, and plain text still renders", () => {
  const r = parseRichReply(JSON.stringify({ headline: "x", chart: "made_up", actions: ["delete_store", "draft_fix", "draft_fix"], bullets: ["1", "2", "3", "4", "5", "6"] }), ctx);
  assert.equal(r.chart, null);
  assert.deepEqual(r.actions.map(a => a.id), ["draft_fix"]);
  assert.equal(r.bullets.length, 5);
  const plain = parseRichReply("AI demand is up.\n- ChatGPT leads\n- Perplexity grows", ctx);
  assert.deepEqual([plain.headline, plain.bullets], ["AI demand is up.", ["ChatGPT leads", "Perplexity grows"]]);
});

test("the briefing names the screen the merchant is on", () => {
  assert.match(storeBriefing(ctx), /MERCHANT IS VIEWING: the AI Sales screen/);
});

test("live demo writes create the product once, apply the fix, and undo restores it", async () => {
  const { applyFixLive, undoFixLive } = await import("../src/demo-store.ts");
  const { suggestFix } = await import("../src/weekly-fix.ts");
  const { runAnswerCheck, createAnswerProviders, DEMO_NORTHPINE_CATALOG } = await import("../src/answer-check/index.ts");
  const { DEMO_SALES_SNAPSHOT } = await import("../src/demo-sales.ts");
  const s = suggestFix({ sales: DEMO_SALES_SNAPSHOT, answerCheck: await runAnswerCheck({ catalog: DEMO_NORTHPINE_CATALOG, providers: createAnswerProviders({}) }), catalog: DEMO_NORTHPINE_CATALOG })!;
  const product = DEMO_NORTHPINE_CATALOG.products.find(p => p.id === s.productId)!;
  const store = new Map<string, { title: string; html: string }>();
  const calls: string[] = [];
  const run = async (q: string, v: any) => {
    const op = q.match(/(query|mutation) (\w+)/)![2]!;
    calls.push(op);
    if (op === "CenturionFind") return { data: { products: { nodes: [...store].map(([id, p]) => ({ id, title: p.title })) } } };
    if (op === "CenturionSeed") {
      store.set("gid://shopify/Product/42", { title: v.product.title, html: v.product.descriptionHtml });
      return { data: { productCreate: { product: { id: "gid://shopify/Product/42" }, userErrors: [] } } };
    }
    if (op === "CenturionProduct") return { data: { product: { descriptionHtml: store.get(v.id)!.html } } };
    if (op === "CenturionFix") {
      store.get(v.product.id)!.html = v.product.descriptionHtml;
      return { data: { productUpdate: { product: { id: v.product.id }, userErrors: [] } } };
    }
    throw new Error(op);
  };
  const env = { CENTURION_STORE_WRITES: "on" };
  const r = await applyFixLive(run, "demo-shop", s, product, env);
  assert.equal(r.createdProduct, true);
  assert.equal(r.adminUrl, "https://admin.shopify.com/store/demo-shop/products/42");
  assert.match(store.get("gid://shopify/Product/42")!.html, /Weight: 1\.3 kg\. Not ultralight\./);
  await assert.rejects(applyFixLive(run, "demo-shop", s, product, env), /already on the product/);
  assert.equal(calls.filter(c => c === "CenturionSeed").length, 1, "created once, found the second time");
  assert.equal(await undoFixLive(run, { productId: r.productId, suggestion: s, beforeHtml: r.beforeHtml, afterHtml: r.afterHtml }, env), "restored");
  assert.equal(store.get("gid://shopify/Product/42")!.html, r.beforeHtml);
  await assert.rejects(applyFixLive(run, "demo-shop", s, product, {}), /writes are off/);
});
