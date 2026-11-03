/**
 * Self-check: starts the built server over stdio as different agent tiers, calls its tools,
 * checks the evidence chain, and exits non-zero on any failure.
 * Run with: npm run build && npm run smoke
 */
import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { verifyChain } from "../src/evidence.js";

const LOG = "smoke-evidence.jsonl";
rmSync(LOG, { force: true });

async function connect(env: Record<string, string>) {
  const client = new Client({ name: "smoke-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: { ...getDefaultEnvironment(), EVIDENCE_LOG: LOG, EVIDENCE_SECRET: "smoke", BRAND_TODAY: "2026-10-23", ...env }
    })
  );
  return client;
}

const text = (r: Awaited<ReturnType<Client["callTool"]>>) =>
  (r.content as { type: string; text: string }[]).map(c => c.text).join("\n");

// 1. Anonymous agent: can read facts, cannot see offers or orders
{
  const c = await connect({ BRAND_AGENT_ID: "crawler-x", BRAND_AGENT_TIER: "anonymous" });
  const { tools } = await c.listTools();
  assert.equal(tools.length, 9, `expected 9 tools, got ${tools.map(t => t.name).join(", ")}`);

  const search = await c.callTool({ name: "brand_search_products", arguments: { query: "jacket", response_format: "json" } });
  assert.ok(!search.isError, text(search));
  assert.equal((search.structuredContent as { total: number }).total, 1);

  const claim = await c.callTool({ name: "brand_check_claim", arguments: { sku: "NP-TH2", claim: "This jacket is waterproof" } });
  assert.equal((claim.structuredContent as { verdict: string }).verdict, "prohibited", text(claim));

  const offers = await c.callTool({ name: "brand_get_offers", arguments: {} });
  assert.equal(offers.isError, true, "anonymous agents must not see offers");

  const bad = await c.callTool({ name: "brand_get_product_facts", arguments: { sku: "" } });
  assert.equal(bad.isError, true, "empty SKU must be rejected");
  await c.close();
}

// 2. Linked member agent: sees member offer, order status, can start a return (idempotent)
{
  const c = await connect({ BRAND_AGENT_ID: "personal-agent", BRAND_AGENT_TIER: "linked_member", BRAND_SUBJECT: "member_123" });
  const offers = await c.callTool({ name: "brand_get_offers", arguments: { response_format: "json" } });
  assert.ok(!offers.isError, text(offers));
  assert.equal((offers.structuredContent as { offers: { id: string }[] }).offers[0]?.id, "member-10");

  const status = await c.callTool({ name: "brand_get_order_status", arguments: { order_id: "NP-100482", response_format: "json" } });
  assert.equal((status.structuredContent as { returnable: boolean }).returnable, true, text(status));

  const r1 = await c.callTool({ name: "brand_start_return", arguments: { order_id: "NP-100482", sku: "NP-TH2", reason: "too_small" } });
  const r2 = await c.callTool({ name: "brand_start_return", arguments: { order_id: "NP-100482", sku: "NP-TH2", reason: "too_small" } });
  assert.ok(!r1.isError, text(r1));
  assert.equal(text(r1).match(/RMA-\S+/)?.[0], text(r2).match(/RMA-\S+/)?.[0], "same return twice must give the same RMA");

  const inTransit = await c.callTool({ name: "brand_start_return", arguments: { order_id: "NP-100917", sku: "NP-RB45", reason: "changed_mind" } });
  assert.equal(inTransit.isError, true, "undelivered orders cannot be returned");
  await c.close();
}

// 3. Wholesale buyer agent: discount above the ceiling is capped; MOQ enforced
{
  const c = await connect({ BRAND_AGENT_ID: "coupa-buyer", BRAND_AGENT_TIER: "wholesale_account", BRAND_SUBJECT: "acct_trailshop" });
  const quote = await c.callTool({
    name: "brand_request_wholesale_quote",
    arguments: { lines: [{ sku: "NP-TH2", qty: 24 }], requested_discount_pct: 8 }
  });
  assert.ok(!quote.isError, text(quote));
  const q = quote.structuredContent as { discount_pct: number; discount_capped: boolean; total_usd: number };
  assert.equal(q.discount_pct, 5);
  assert.equal(q.discount_capped, true);
  assert.equal(q.total_usd, 2610.72); // 114.50 x 0.95 = 108.78 per unit, x 24

  const underMoq = await c.callTool({ name: "brand_request_wholesale_quote", arguments: { lines: [{ sku: "NP-TH2", qty: 3 }] } });
  assert.equal(underMoq.isError, true, "below MOQ must be refused");
  await c.close();
}

// 4. Evidence chain is intact and recorded every call
const chain = verifyChain(LOG, "smoke");
assert.ok(chain.ok, `evidence chain broken at line ${chain.broken_at}`);
// 10 calls reach a handler; the empty-SKU call is rejected by schema validation before it, so it is not logged.
assert.equal(chain.entries, 10, `expected 10 evidence entries, got ${chain.entries}`);

console.error(`Smoke test passed (${chain.entries} evidence entries, chain intact)`);
