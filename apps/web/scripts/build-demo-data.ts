// Runs the real AI Sales engine on the sample store and writes apps/web/data/demo.json, using the
// same buildView the Shopify app uses. Run from apps/web/: npm run demo-data
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildView, currentSignatures, type Order } from "@centurion/core/server";

const here = dirname(fileURLToPath(import.meta.url));
const orders: Order[] = JSON.parse(readFileSync(resolve(here, "../../../packages/attribution/data/sample-orders.json"), "utf8"));
const view = buildView({ orders, file: currentSignatures, store: { name: "Northpine Outfitters", domain: "northpine.example" } });

const out = resolve(here, "../data/demo.json");
writeFileSync(out, `${JSON.stringify(view, null, 2)}\n`);
console.log(`Wrote ${out}: ${view.aiOrders.length} AI orders of ${orders.length}, signatures ${view.signaturesVersion}`);
