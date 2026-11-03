import type { Report } from "../../attribution/src/report.ts";
import type { Evidence, Touch } from "../../attribution/src/types.ts";

export type { Report, Evidence, Touch };

/** One AI order as both apps show it, with the proof lines the owner can check in Shopify. */
export interface AiOrderRow {
  name: string;
  createdAt: string;
  total: number;
  source: string;
  touch: Touch | null;
  evidence: Evidence | null;
  proof: string[];
  items: { title: string; quantity: number }[];
}

/**
 * Everything the AI Sales screen needs. The web app and the Shopify app render this exact
 * shape, built by the same function, from the same rows, so their numbers cannot drift.
 */
export interface AiSalesView {
  generatedAt: string;
  signaturesVersion: string;
  store: { name: string; domain: string };
  report: Report;
  aiOrders: AiOrderRow[];
  candidates: {
    orders: number;
    revenue: number;
    examples: { name: string; total: number; proof: string[] }[];
  };
}
