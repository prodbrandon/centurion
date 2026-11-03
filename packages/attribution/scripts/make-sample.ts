// Generates a realistic, seeded sample of 90 days of Shopify orders for a fictional brand,
// so the engine can be built and demoed without a real store's data.
import { writeFileSync } from "node:fs";
import type { Order, Visit } from "../src/types.ts";

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;

const PRODUCTS = [
  { title: "Trailhead 2 Down Jacket", sku: "NP-TH2", price: 229, handle: "trailhead-2-down-jacket" },
  { title: "Ridgeback 45L Pack", sku: "NP-RB45", price: 189, handle: "ridgeback-45l-pack" },
  { title: "Cedar Merino Base Layer", sku: "NP-CM2", price: 89, handle: "cedar-merino-base-layer" },
  { title: "Basecamp 2P Tent", sku: "NP-BC2", price: 349, handle: "basecamp-2p-tent" },
  { title: "Switchback Trail Runner", sku: "NP-SB1", price: 139, handle: "switchback-trail-runner" },
  { title: "Summit Wool Beanie", sku: "NP-SWB", price: 32, handle: "summit-wool-beanie" }
];

const END = Date.parse("2026-10-22T23:00:00Z");
const DAYS = 90;
const visit = (v: Partial<Visit>): Visit => ({ sourceType: null, source: null, referrerUrl: null, landingPage: "/", utmSource: null, ...v });
const productPage = (p: (typeof PRODUCTS)[number]) => `/products/${p.handle}`;

const orders: Order[] = [];
for (let i = 0; i < 1500; i++) {
  const dayAgo = Math.floor(rand() * DAYS);
  const createdAt = new Date(END - dayAgo * 864e5 - Math.floor(rand() * 864e5)).toISOString();
  const growth = 1 + (DAYS - dayAgo) / DAYS; // AI share roughly doubles over the window
  const p = pick(PRODUCTS);
  const qty = rand() < 0.85 ? 1 : 2;
  const r = rand();
  let first: Visit;
  let last: Visit;
  let channel: string | null = "Online Store";

  if (r < 0.022 * growth) {
    first = visit({ source: "chatgpt.com", sourceType: "referral", landingPage: `${productPage(p)}?utm_source=chatgpt.com` });
    last = rand() < 0.5 ? visit({ sourceType: "direct", landingPage: productPage(p) }) : first;
  } else if (r < 0.028 * growth) {
    first = visit({ sourceType: "search", source: "google", referrerUrl: "https://www.google.com/" });
    last = visit({ sourceType: "referral", referrerUrl: "https://chatgpt.com/", landingPage: productPage(p) });
  } else if (r < 0.032 * growth) {
    first = visit({ sourceType: "referral", referrerUrl: "https://www.perplexity.ai/search/best-packable-down", landingPage: productPage(p) });
    last = first;
  } else if (r < 0.035 * growth) {
    first = visit({ sourceType: "referral", referrerUrl: "https://gemini.google.com/", landingPage: productPage(p) });
    last = first;
  } else if (r < 0.037 * growth) {
    first = visit({ sourceType: "referral", referrerUrl: "https://copilot.microsoft.com/", landingPage: productPage(p) });
    last = first;
  } else if (r < 0.040 * growth) {
    channel = "ChatGPT";
    first = visit({ sourceType: "unknown" });
    last = first;
  } else if (r < 0.042 * growth) {
    first = visit({ sourceType: "referral", referrerUrl: "https://chat.mistral.ai/", landingPage: productPage(p) });
    last = first;
  } else if (r < 0.13) {
    first = visit({ sourceType: "direct", landingPage: productPage(p) });
    last = first;
  } else {
    const kind = pick(["google", "instagram", "email", "direct-home", "google"]);
    first =
      kind === "google" ? visit({ sourceType: "search", source: "google", referrerUrl: "https://www.google.com/" })
      : kind === "instagram" ? visit({ sourceType: "social", referrerUrl: "https://l.instagram.com/", utmSource: "instagram" })
      : kind === "email" ? visit({ sourceType: "email", utmSource: "klaviyo", landingPage: productPage(p) })
      : visit({ sourceType: "direct", landingPage: "/" });
    last = first;
  }

  orders.push({
    id: `gid://shopify/Order/${100000 + i}`,
    name: `#${10000 + i}`,
    createdAt,
    total: p.price * qty,
    currency: "USD",
    channel,
    firstVisit: first,
    lastVisit: last,
    lineItems: [{ title: p.title, sku: p.sku, quantity: qty, total: p.price * qty }]
  });
}

orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
writeFileSync(process.argv[2] ?? "data/sample-orders.json", `${JSON.stringify(orders, null, 2)}\n`);
console.error(`Wrote ${orders.length} sample orders.`);
