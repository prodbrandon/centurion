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
