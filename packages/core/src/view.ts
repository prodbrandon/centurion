import { classifyOrders } from "../../attribution/src/classify.ts";
import { buildReport } from "../../attribution/src/report.ts";
import type { Attribution, Order, SignatureFile } from "../../attribution/src/types.ts";
import type { AiSalesView } from "./types.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Normalizes orders so the same orders give the same view no matter where they came from
 * (Shopify API, sample file, or a Postgres round trip): ISO timestamps with milliseconds,
 * cents-rounded totals, sorted by time then id.
 */
export function canonicalOrders(orders: Order[]): Order[] {
  return orders
    .map(o => ({ ...o, createdAt: new Date(o.createdAt).toISOString(), total: round2(o.total) }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Builds the view from canonical orders and their attributions. The only place the view is assembled. */
export function assembleView(input: {
  orders: Order[];
  attributions: Attribution[];
  file: SignatureFile;
  store: { name: string; domain: string };
  generatedAt: string;
}): AiSalesView {
  const { orders, file } = input;
  const position = new Map(orders.map((o, i) => [o.id, i]));
  const attributions = [...input.attributions].sort((a, b) => (position.get(a.orderId) ?? 0) - (position.get(b.orderId) ?? 0));
  const report = buildReport(orders, attributions, file.signatures);

  const byId = new Map(orders.map(o => [o.id, o]));
  const label = (id: string | null) => file.signatures.find(s => s.id === id)?.label ?? id ?? "";
  const items = (id: string) => (byId.get(id)?.lineItems ?? []).map(li => ({ title: li.title, quantity: li.quantity }));

  const aiOrders = attributions
    .filter(a => a.isAI)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(a => ({
      name: a.orderName,
      createdAt: a.createdAt,
      total: a.total,
      source: label(a.source),
      touch: a.touch,
      evidence: a.evidence,
      proof: a.proof,
      items: items(a.orderId)
    }));

  const candidates = attributions.filter(a => a.evidence === "candidate");

  return {
    generatedAt: input.generatedAt,
    signaturesVersion: file.version,
    store: input.store,
    report,
    aiOrders,
    candidates: {
      orders: report.candidates.orders,
      revenue: report.candidates.revenue,
      examples: candidates.slice(0, 5).map(a => ({ name: a.orderName, total: a.total, proof: a.proof }))
    }
  };
}

/** Classifies orders with the engine and builds the view. Used for demo data and before saving a run. */
export function buildView(input: {
  orders: Order[];
  file: SignatureFile;
  store: { name: string; domain: string };
  generatedAt?: string;
}): AiSalesView {
  const orders = canonicalOrders(input.orders);
  return assembleView({
    orders,
    attributions: classifyOrders(orders, input.file.signatures),
    file: input.file,
    store: input.store,
    generatedAt: input.generatedAt ?? new Date().toISOString()
  });
}
