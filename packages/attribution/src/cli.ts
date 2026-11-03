#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as z from "zod/v4";
import { classifyOrders, loadSignatures } from "./classify.ts";
import { discoverCandidates, promoteSignature } from "./discover.ts";
import { buildReport, renderMarkdown } from "./report.ts";
import { fetchOrders } from "./shopify.ts";
import { OrderSchema, type Order } from "./types.ts";

const HELP = `attribution: find the orders AI sent you

  attribution report   --input orders.json | --shop x.myshopify.com --token T [--days 90] [--json] [--out file]
  attribution discover --input orders.json | --shop ... --token ...
  attribution promote  --id name --label Name --vendor Vendor (--host h | --utm u) --by you

Env: AI_SIGNATURES (signature file path), SHOPIFY_API_VERSION`;

async function loadOrders(v: Record<string, string | boolean | undefined>): Promise<Order[]> {
  if (typeof v.input === "string") return z.array(OrderSchema).parse(JSON.parse(readFileSync(v.input, "utf8")));
  if (typeof v.shop === "string" && typeof v.token === "string") {
    return fetchOrders({ shop: v.shop, token: v.token, days: Number(v.days ?? 90) });
  }
  throw new Error("Give --input orders.json, or --shop and --token.");
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      input: { type: "string" }, shop: { type: "string" }, token: { type: "string" }, days: { type: "string" },
      json: { type: "boolean" }, out: { type: "string" }, store: { type: "string" },
      id: { type: "string" }, label: { type: "string" }, vendor: { type: "string" },
      host: { type: "string" }, utm: { type: "string" }, by: { type: "string" }
    }
  });
  const sigPath = process.env.AI_SIGNATURES;
  const file = loadSignatures(sigPath);

  if (command === "report") {
    const orders = await loadOrders(values);
    const report = buildReport(orders, classifyOrders(orders, file.signatures), file.signatures);
    const text = values.json ? JSON.stringify(report, null, 2) : renderMarkdown(report, values.store ?? values.shop ?? "Your store");
    if (values.out) writeFileSync(values.out, `${text}\n`);
    else process.stdout.write(`${text}\n`);
    return;
  }
  if (command === "discover") {
    const orders = await loadOrders(values);
    const found = discoverCandidates(orders, file, values.shop?.replace(".myshopify.com", ""));
    if (found.length === 0) return void process.stdout.write("No unknown referrers or utm tags with orders.\n");
    process.stdout.write("Unknown sources that drove orders (approve real AI sources with `attribution promote`):\n");
    for (const c of found.slice(0, 20)) {
      process.stdout.write(`- ${c.kind} ${c.value}: ${c.orders} orders, $${c.revenue} (e.g. ${c.example_order})\n`);
    }
    return;
  }
  if (command === "promote") {
    if (!values.id || !values.label || !values.vendor || !values.by || (!values.host && !values.utm)) {
      throw new Error("promote needs --id, --label, --vendor, --by and --host or --utm.");
    }
    const path = sigPath ?? fileURLToPath(new URL("../data/signatures.json", import.meta.url));
    const next = promoteSignature(file, path, {
      id: values.id, label: values.label, vendor: values.vendor, host: values.host, utm: values.utm, approvedBy: values.by
    });
    process.stdout.write(`Added to signatures, now version ${next.version}.\n`);
    return;
  }
  process.stdout.write(`${HELP}\n`);
}

main().catch(err => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
