// Generates a realistic, seeded sample of 90 days of Shopify orders for a fictional brand,
// so the engine can be built and demoed without a real store's data.
import { writeFileSync } from "node:fs";
import type { Order, Visit } from "../src/types.ts";

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;

// Northpine Outfitters as a mid-market brand: 64 products and about 250 variant SKUs across 8 categories.
// The first six are the hero products the Answer Check and Weekly Fix demos are written about.
type Product = { title: string; sku: string; price: number; handle: string; weight: number; variants: string[] };
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const SIZES = ["XS", "S", "M", "L", "XL"];
const APPAREL = ["Black", "Moss"].flatMap(c => SIZES.map(z => `${c} ${z}`));
const HEROES: Product[] = [
  { title: "Trailhead 2 Down Jacket", sku: "NP-TH2", price: 229, handle: "trailhead-2-down-jacket", weight: 7, variants: SIZES },
  { title: "Ridgeback 45L Pack", sku: "NP-RB45", price: 189, handle: "ridgeback-45l-pack", weight: 9, variants: ["S/M", "M/L"] },
  { title: "Cedar Merino Base Layer", sku: "NP-CM2", price: 89, handle: "cedar-merino-base-layer", weight: 6, variants: SIZES },
  { title: "Basecamp 2P Tent", sku: "NP-BC2", price: 349, handle: "basecamp-2p-tent", weight: 6, variants: ["Sage", "Sand"] },
  { title: "Switchback Trail Runner", sku: "NP-SB1", price: 139, handle: "switchback-trail-runner", weight: 6, variants: ["8", "9", "10", "11", "12"] },
  { title: "Summit Wool Beanie", sku: "NP-SWB", price: 32, handle: "summit-wool-beanie", weight: 5, variants: ["Charcoal", "Rust"] }
];
const CATALOG: [string, string, number, string[], string[]][] = [
  // [category code, names, base price, variant options, product names]
  ["JK", "Jackets", 179, APPAREL, ["Ridgeline Rain Shell", "Alpenglow Fleece", "Coastal Wind Shell", "Talus Insulated Vest", "Granite Softshell", "Fjord Parka", "Highline Hybrid Hoodie", "Larch Synthetic Jacket"]],
  ["PK", "Packs", 129, ["One size"], ["Ridgeback 30L Daypack", "Ridgeback 65L Pack", "Sidecut 18L Ski Pack", "Canyon Hip Pack", "Portage Duffel 60L", "Kestrel Hydration Pack", "Summit Sling"]],
  ["BL", "Base layers", 79, APPAREL, ["Cedar Merino Bottoms", "Cedar Merino Hoodie", "Driftwood Tech Tee", "Aspen Midweight Crew", "Aspen Midweight Bottoms", "Mesa Sun Hoodie"]],
  ["TN", "Tents & shelters", 299, ["Sage", "Sand"], ["Basecamp 3P Tent", "Ultralight 1P Tent", "Ridgeline Tarp", "Cascade 4P Family Tent", "Bivy Sack", "Trail Shelter Footprint"]],
  ["FW", "Footwear", 149, ["8", "9", "10", "11", "12"], ["Switchback Mid GTX", "Scree Approach Shoe", "Talus Winter Boot", "Riverbed Sandal", "Cairn Hiking Boot", "Fastpack Trail Runner"]],
  ["AC", "Accessories", 39, ["One size"], ["Summit Liner Gloves", "Ridgeline Trekking Poles", "Trail Gaiters", "Merino Hiking Socks 3-Pack", "Neck Gaiter", "Camp Mug", "Headlamp 400", "Dry Bag Set"]],
  ["SL", "Sleep systems", 189, ["Regular", "Long"], ["Nightfall 20F Sleeping Bag", "Nightfall 0F Sleeping Bag", "Featherlite Quilt", "Airframe Sleeping Pad", "Foam Trail Pad", "Camp Pillow"]],
  ["KT", "Camp kitchen", 69, ["One size"], ["Ember Stove", "Titanium Cook Set", "Trail Kettle", "Spork & Knife Kit", "Water Filter Pro", "Collapsible Bowl Set", "Bear Canister"]]
];
let n = 0;
const PRODUCTS: Product[] = [
  ...HEROES,
  ...CATALOG.flatMap(([code, , base, variants, names]) =>
    names.map((title, i) => ({
      title,
      sku: `NP-${code}${String(++n).padStart(3, "0")}`,
      price: Math.round(base * (0.55 + ((i * 37) % 10) / 10)), // spread prices around the category base
      handle: slug(title),
      weight: 3 / (1 + i * 0.6), // a few strong sellers per category, a long tail behind them
      variants
    }))
  )
];
const TOTAL_WEIGHT = PRODUCTS.reduce((t, p) => t + p.weight, 0);
const pickProduct = (): Product => {
  let r = rand() * TOTAL_WEIGHT;
  for (const p of PRODUCTS) if ((r -= p.weight) <= 0) return p;
  return PRODUCTS.at(-1)!;
};
export const SKU_COUNT = PRODUCTS.reduce((t, p) => t + p.variants.length, 0);

const END = Date.parse("2026-10-22T23:00:00Z");
const DAYS = 90;
const visit = (v: Partial<Visit>): Visit => ({ sourceType: null, source: null, referrerUrl: null, landingPage: "/", utmSource: null, ...v });
const productPage = (p: (typeof PRODUCTS)[number]) => `/products/${p.handle}`;

const orders: Order[] = [];
const ORDERS = 12000;
for (let i = 0; i < ORDERS; i++) {
  const dayAgo = Math.floor(rand() * DAYS);
  // END is 23:00 UTC; up to 23 hours earlier keeps each order on its day, so the window is exactly 90 days.
  const createdAt = new Date(END - dayAgo * 864e5 - Math.floor(rand() * 864e5 * (23 / 24))).toISOString();
  const growth = 1 + (DAYS - dayAgo) / DAYS; // AI share roughly doubles over the window
  // The first item is what the shopper came for (and where AI links land); baskets add one or two more.
  const p = pickProduct();
  const basket = [p, ...(rand() < 0.3 ? [pickProduct()] : []), ...(rand() < 0.08 ? [pickProduct()] : [])];
  const lineItems = basket.map(item => {
    const quantity = rand() < 0.88 ? 1 : 2;
    return { title: item.title, sku: `${item.sku}-${slug(pick(item.variants))}`.toUpperCase(), quantity, total: item.price * quantity };
  });
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
    total: lineItems.reduce((t, l) => t + l.total, 0),
    currency: "USD",
    channel,
    firstVisit: first,
    lastVisit: last,
    lineItems
  });
}

orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
// Compact, one order per line: 12,000 orders stay small in git and diff line by line.
writeFileSync(process.argv[2] ?? "data/sample-orders.json", `[\n${orders.map(o => JSON.stringify(o)).join(",\n")}\n]\n`);
console.error(`Wrote ${orders.length} sample orders across ${PRODUCTS.length} products and ${SKU_COUNT} SKUs.`);
