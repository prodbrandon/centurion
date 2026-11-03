import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyOrder, loadSignatures } from "../src/classify.ts";
import { discoverCandidates } from "../src/discover.ts";
import { buildReport } from "../src/report.ts";
import type { Order, Visit } from "../src/types.ts";

const { signatures, ...file } = loadSignatures();
const sigFile = { ...file, signatures };

const order = (first: Partial<Visit> | null, last: Partial<Visit> | null = first, channel: string | null = "Online Store", total = 100): Order => ({
  id: `gid://shopify/Order/${Math.random()}`,
  name: "#1",
  createdAt: "2026-10-20T10:00:00Z",
  total,
  currency: "USD",
  channel,
  firstVisit: first,
  lastVisit: last,
  lineItems: [{ title: "Trailhead 2 Down Jacket", quantity: 1, total }]
});

test("order placed in an AI channel is checkout_in_ai", () => {
  const a = classifyOrder(order({}, {}, "ChatGPT"), signatures);
  assert.equal(a.isAI, true);
  assert.equal(a.evidence, "checkout_in_ai");
  assert.equal(a.source, "chatgpt");
});

test("utm_source inside the landing URL is caught even when the parsed field is empty", () => {
  const a = classifyOrder(order({ landingPage: "/products/x?utm_source=chatgpt.com" }), signatures);
  assert.equal(a.evidence, "utm");
  assert.equal(a.touch, "both");
});

test("referrer on last visit only counts as last touch", () => {
  const a = classifyOrder(order({ referrerUrl: "https://www.google.com/" }, { referrerUrl: "https://www.perplexity.ai/search/x" }), signatures);
  assert.equal(a.source, "perplexity");
  assert.equal(a.touch, "last");
  assert.equal(a.evidence, "referrer");
});

test("subdomains match but look-alike domains do not", () => {
  assert.equal(classifyOrder(order({ referrerUrl: "https://chat.openai.com/" }), signatures).source, "chatgpt");
  assert.equal(classifyOrder(order({ referrerUrl: "https://notchatgpt.com/" }), signatures).isAI, false);
});

test("direct visit to a product page is a candidate, never counted as AI", () => {
  const a = classifyOrder(order({ sourceType: "direct", landingPage: "/products/trailhead" }), signatures);
  assert.equal(a.isAI, false);
  assert.equal(a.evidence, "candidate");
});

test("google and instagram are not AI", () => {
  assert.equal(classifyOrder(order({ referrerUrl: "https://www.google.com/" }), signatures).isAI, false);
  assert.equal(classifyOrder(order({ utmSource: "instagram" }), signatures).isAI, false);
});

test("report totals and shares add up", () => {
  const orders = [
    order({ referrerUrl: "https://chatgpt.com/" }, undefined, "Online Store", 200),
    order({ referrerUrl: "https://www.google.com/" }, undefined, "Online Store", 100),
    order({ sourceType: "direct", landingPage: "/products/x" }, undefined, "Online Store", 50)
  ];
  const r = buildReport(orders, orders.map(o => classifyOrder(o, signatures)), signatures);
  assert.equal(r.revenue, 350);
  assert.equal(r.ai.revenue, 200);
  assert.equal(r.ai.share_of_revenue, 57.14);
  assert.equal(r.candidates.orders, 1);
});

test("discovery surfaces unknown referrers and ignores known and non-AI ones", () => {
  const orders = [
    order({ referrerUrl: "https://chat.mistral.ai/" }),
    order({ referrerUrl: "https://chatgpt.com/" }),
    order({ referrerUrl: "https://www.google.com/" })
  ];
  const found = discoverCandidates(orders, sigFile);
  assert.deepEqual(found.map(f => f.value), ["chat.mistral.ai"]);
  assert.equal(found[0]?.orders, 1, "first and last visit from the same source count once");
});

test("discovery ignores common marketing utm tags", () => {
  const found = discoverCandidates([order({ utmSource: "instagram" }), order({ utmSource: "klaviyo" })], sigFile);
  assert.equal(found.length, 0);
});
