import * as z from "zod/v4";

// Order shape: a trimmed version of the Shopify Admin GraphQL Order, including
// customerJourneySummary (first and last visit). Fetching code maps API results into this.

export const VisitSchema = z.object({
  occurredAt: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  sourceType: z.string().nullable().optional(),
  referrerUrl: z.string().nullable().optional(),
  landingPage: z.string().nullable().optional(),
  utmSource: z.string().nullable().optional(),
  utmMedium: z.string().nullable().optional(),
  utmCampaign: z.string().nullable().optional()
});
export type Visit = z.infer<typeof VisitSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  total: z.number(),
  currency: z.string(),
  channel: z.string().nullable().optional(),
  firstVisit: VisitSchema.nullable().optional(),
  lastVisit: VisitSchema.nullable().optional(),
  lineItems: z.array(z.object({ title: z.string(), sku: z.string().nullable().optional(), quantity: z.number(), total: z.number() }))
});
export type Order = z.infer<typeof OrderSchema>;

export const SignatureSchema = z.object({
  id: z.string(),
  label: z.string(),
  vendor: z.string(),
  referrer_hosts: z.array(z.string()),
  utm_sources: z.array(z.string()),
  channel_patterns: z.array(z.string()),
  added: z.string(),
  added_by: z.string()
});
export type Signature = z.infer<typeof SignatureSchema>;

export const SignatureFileSchema = z.object({
  version: z.string(),
  notes: z.string().optional(),
  signatures: z.array(SignatureSchema),
  known_limits: z.array(z.string()).optional()
});
export type SignatureFile = z.infer<typeof SignatureFileSchema>;

/**
 * How sure we are that AI sent this order.
 * - checkout_in_ai: the order was placed through an AI channel (e.g. an agentic storefront).
 * - referrer: the visit came from an AI assistant's domain.
 * - utm: the visit carried an AI utm_source (in the parsed field or the landing URL).
 * - candidate: no AI signal, but the pattern often hides AI traffic (direct visit straight to a product page).
 *   Candidates are reported separately and never counted as AI revenue.
 */
export type Evidence = "checkout_in_ai" | "referrer" | "utm" | "candidate";
export type Touch = "first" | "last" | "both" | "checkout";

export interface Attribution {
  orderId: string;
  orderName: string;
  createdAt: string;
  total: number;
  isAI: boolean;
  source: string | null; // signature id
  touch: Touch | null;
  evidence: Evidence | null;
  proof: string[]; // human-readable lines the brand can check in Shopify
}
