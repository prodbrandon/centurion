import { connection } from "next/server";
import { cache } from "react";
import { getDb, loadLatestView, type AiSalesView } from "@centurion/core/server";
import demo from "@/data/demo.json";

export { EVIDENCE_WORDS, money, shortDate, TOUCH_WORDS } from "@centurion/core";
export type { AiOrderRow as AiOrder, AiSalesView } from "@centurion/core";

export type AiSales =
  | { mode: "demo"; view: AiSalesView }
  | { mode: "live"; shop: string; view: AiSalesView | null };

/**
 * Demo mode (default): the engine's output on the sample store, from data/demo.json.
 * Live mode: set CENTURION_SHOP and DATABASE_URL to read the same Supabase rows the Shopify
 * app writes. Live mode has no login yet, so never set it on a public deployment.
 * Cached per request so the layout and page share one query.
 */
export const getAiSales = cache(async (): Promise<AiSales> => {
  const shop = process.env.CENTURION_SHOP;
  if (!shop) return { mode: "demo", view: demo as AiSalesView };
  await connection(); // render per request, never at build time
  const db = getDb();
  if (!db) throw new Error("CENTURION_SHOP is set but DATABASE_URL is not.");
  return { mode: "live", shop, view: await loadLatestView(db, shop) };
});
