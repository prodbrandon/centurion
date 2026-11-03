import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";

// The rulebook is the brand's single source of truth for agents. In the product it is
// compiled from the editor; here it is a JSON file so the server runs standalone.

export const SourceSchema = z.object({
  system: z.string(),
  ref: z.string(),
  updated: z.string()
});

export const FactSchema = z.object({
  attribute: z.string(),
  value: z.string(),
  source: SourceSchema
});

export const ProductSchema = z.object({
  sku: z.string(),
  title: z.string(),
  category: z.string(),
  price_usd: z.number(),
  in_stock: z.boolean(),
  facts: z.array(FactSchema),
  approved_claims: z.array(z.string()),
  prohibited_claims: z.array(z.string())
});

export const TIER_NAMES = ["anonymous", "verified_agent", "linked_member", "wholesale_account"] as const;
export const TierNameSchema = z.enum(TIER_NAMES);
export type TierName = z.infer<typeof TierNameSchema>;

export const READ_CAPS = ["facts", "claims", "policies", "products", "offers", "orders", "wholesale"] as const;
export const ACT_CAPS = ["start_return", "request_quote"] as const;
export type ReadCap = (typeof READ_CAPS)[number];
export type ActCap = (typeof ACT_CAPS)[number];

const TierSchema = z.object({
  description: z.string(),
  can_read: z.array(z.enum(READ_CAPS)),
  can_act: z.array(z.enum(ACT_CAPS)),
  max_order_usd: z.number()
});

const RulebookSchema = z.object({
  brand: z.object({ name: z.string(), domain: z.string(), rulebook_version: z.string() }),
  tiers: z.record(TierNameSchema, TierSchema),
  policies: z.array(z.object({ id: z.string(), title: z.string(), text: z.string(), source: SourceSchema })),
  products: z.array(ProductSchema),
  offers: z.array(
    z.object({
      id: z.string(),
      tier: TierNameSchema,
      // Offers may only be keyed to loyalty membership or published promotions, never to personal data.
      // This keeps the gateway outside state surveillance-pricing rules (see the compliance section).
      basis: z.enum(["loyalty_program", "published_promotion"]),
      description: z.string(),
      percent_off: z.number().min(0).max(100),
      applies_to: z.union([z.literal("all"), z.array(z.string())]),
      expires: z.string()
    })
  ),
  wholesale: z.object({
    terms: z.string(),
    max_discount_pct: z.number(),
    price_list: z.array(z.object({ sku: z.string(), unit_usd: z.number(), moq: z.number().int() }))
  }),
  orders: z.array(
    z.object({
      id: z.string(),
      member_id: z.string(),
      status: z.enum(["processing", "in_transit", "delivered", "cancelled"]),
      placed_at: z.string(),
      delivered_at: z.string().nullable(),
      items: z.array(z.object({ sku: z.string(), qty: z.number().int(), price_usd: z.number() }))
    })
  )
});

export type Rulebook = z.infer<typeof RulebookSchema>;
export type Product = z.infer<typeof ProductSchema>;

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(here, "..", "data", "rulebook.json");

export function loadRulebook(path = process.env.BRAND_RULEBOOK ?? DEFAULT_PATH): Rulebook {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = RulebookSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Rulebook at ${path} is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}
