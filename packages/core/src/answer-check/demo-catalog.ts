// DEMO catalog for the fictional Northpine Outfitters store. Mirrors apps/gateway/data/rulebook.json
// (rulebook 2026-10-23.1) so the gateway, the web demo and the fixture runs agree on every fact.
// Never shown as a real store: Catalog.demo is true and every screen labels it.
import type { Catalog } from "./types.ts";

export const DEMO_NORTHPINE_CATALOG: Catalog = {
  store: { name: "Northpine Outfitters", domain: "northpine.example" },
  demo: true,
  products: [
    {
      id: "NP-TH2",
      title: "Trailhead 2 Down Jacket",
      description: "Our warmest packable jacket, ready for any weather.",
      price: { amount: 229, currency: "USD", source: { system: "shopify", ref: "product price", updated: "2026-08-01" } },
      stock: { inStock: true, source: { system: "shopify", ref: "inventory", updated: "2026-10-23" } },
      facts: [
        { attribute: "fill_power", value: "800-fill responsibly sourced down", source: { system: "shopify", ref: "metafield specs.fill", updated: "2026-08-01" } },
        { attribute: "water_resistance", value: "DWR-coated shell, handles light rain and snow; not waterproof", source: { system: "notion", ref: "TH2 Lab Results p.2", updated: "2026-07-18" } },
        { attribute: "comfort_rating", value: "Comfortable to -12 C when layered (lab tested)", source: { system: "notion", ref: "TH2 Lab Results p.4", updated: "2026-07-18" } },
        { attribute: "weight", value: "410 g (men's M)", source: { system: "shopify", ref: "metafield specs.weight", updated: "2026-08-01" } }
      ],
      approvedClaims: ["water resistant", "packable", "800-fill down", "warm to -12 C"],
      prohibitedClaims: ["waterproof", "warmest jacket", "lifetime warranty"]
    },
    {
      id: "NP-RB45",
      title: "Ridgeback 45L Pack",
      description: "A 45-liter pack that carries like a daypack, for long weekends on the trail.",
      price: { amount: 189, currency: "USD", source: { system: "shopify", ref: "product price", updated: "2026-05-10" } },
      stock: { inStock: true, source: { system: "shopify", ref: "inventory", updated: "2026-10-23" } },
      facts: [
        { attribute: "volume", value: "45 liters", source: { system: "shopify", ref: "metafield specs.volume", updated: "2026-05-10" } },
        { attribute: "torso_fit", value: "Adjustable torso 16 to 21 inches", source: { system: "shopify", ref: "metafield specs.torso", updated: "2026-05-10" } },
        { attribute: "weight", value: "1.3 kg", source: { system: "shopify", ref: "metafield specs.weight", updated: "2026-05-10" } }
      ],
      approvedClaims: ["adjustable torso", "45 liters", "carry-on compatible"],
      prohibitedClaims: ["fits everyone", "ultralight"]
    },
    {
      id: "NP-CM2",
      title: "Cedar Merino Base Layer",
      description: "Soft merino for cold mornings and long days on the move.",
      price: { amount: 89, currency: "USD", source: { system: "shopify", ref: "product price", updated: "2026-02-01" } },
      stock: { inStock: false, source: { system: "shopify", ref: "inventory", updated: "2026-10-23" } },
      facts: [
        { attribute: "material", value: "100% 200gsm merino wool", source: { system: "shopify", ref: "metafield specs.material", updated: "2026-02-01" } },
        { attribute: "care", value: "Machine wash cold, lay flat to dry", source: { system: "shopify", ref: "metafield specs.care", updated: "2026-02-01" } }
      ],
      approvedClaims: ["merino wool", "machine washable"],
      prohibitedClaims: ["odor-proof", "antibacterial"]
    }
  ],
  policies: [
    {
      id: "returns",
      title: "Returns",
      text: "Unworn items can be returned within 60 days of delivery for a full refund. Return shipping is free for loyalty members.",
      source: { system: "gorgias", ref: "help-center/returns", updated: "2026-03-02" }
    },
    {
      id: "shipping",
      title: "Shipping",
      text: "Free standard shipping on US orders over $75. Standard delivery takes 3 to 5 business days.",
      source: { system: "shopify", ref: "policies/shipping", updated: "2026-01-15" }
    },
    {
      id: "warranty",
      title: "Warranty",
      text: "Outerwear carries a 2-year warranty against manufacturing defects.",
      source: { system: "notion", ref: "Warranty Policy v3", updated: "2025-11-20" }
    }
  ]
};
