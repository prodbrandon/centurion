import type { Attribution, Order, Signature } from "./types.ts";

export interface Report {
  period: { from: string; to: string };
  orders: number;
  revenue: number;
  ai: { orders: number; revenue: number; share_of_revenue: number; avg_order_value: number; non_ai_avg_order_value: number };
  by_source: { source: string; label: string; orders: number; revenue: number }[];
  by_touch: { touch: string; orders: number; revenue: number }[];
  by_evidence: { evidence: string; orders: number; revenue: number }[];
  top_products: { title: string; units: number; revenue: number }[];
  weekly: { week_start: string; ai_revenue: number; total_revenue: number }[];
  candidates: { orders: number; revenue: number };
  sample_proof: { order: string; source: string; total: number; proof: string[] }[];
}

const round = (n: number) => Math.round(n * 100) / 100;

function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function group<T>(items: T[], key: (t: T) => string, value: (t: T) => number) {
  const map = new Map<string, { count: number; sum: number }>();
  for (const it of items) {
    const k = key(it);
    const cur = map.get(k) ?? { count: 0, sum: 0 };
    cur.count += 1;
    cur.sum += value(it);
    map.set(k, cur);
  }
  return [...map.entries()].sort((a, b) => b[1].sum - a[1].sum);
}

export function buildReport(orders: Order[], attributions: Attribution[], signatures: Signature[]): Report {
  const byId = new Map(orders.map(o => [o.id, o]));
  const ai = attributions.filter(a => a.isAI);
  const nonAi = attributions.filter(a => !a.isAI);
  const candidates = attributions.filter(a => a.evidence === "candidate");
  const revenue = attributions.reduce((s, a) => s + a.total, 0);
  const aiRevenue = ai.reduce((s, a) => s + a.total, 0);
  const label = (id: string) => signatures.find(s => s.id === id)?.label ?? id;

  const productTotals = new Map<string, { units: number; revenue: number }>();
  for (const a of ai) {
    for (const li of byId.get(a.orderId)?.lineItems ?? []) {
      const cur = productTotals.get(li.title) ?? { units: 0, revenue: 0 };
      cur.units += li.quantity;
      cur.revenue += li.total;
      productTotals.set(li.title, cur);
    }
  }

  const weeks = new Map<string, { ai: number; total: number }>();
  for (const a of attributions) {
    const w = weekStart(a.createdAt);
    const cur = weeks.get(w) ?? { ai: 0, total: 0 };
    cur.total += a.total;
    if (a.isAI) cur.ai += a.total;
    weeks.set(w, cur);
  }

  const dates = attributions.map(a => a.createdAt).sort();

  return {
    period: { from: dates.at(0)?.slice(0, 10) ?? "", to: dates.at(-1)?.slice(0, 10) ?? "" },
    orders: attributions.length,
    revenue: round(revenue),
    ai: {
      orders: ai.length,
      revenue: round(aiRevenue),
      share_of_revenue: revenue ? round((aiRevenue / revenue) * 100) : 0,
      avg_order_value: ai.length ? round(aiRevenue / ai.length) : 0,
      non_ai_avg_order_value: nonAi.length ? round((revenue - aiRevenue) / nonAi.length) : 0
    },
    by_source: group(ai, a => a.source ?? "unknown", a => a.total).map(([k, v]) => ({ source: k, label: label(k), orders: v.count, revenue: round(v.sum) })),
    by_touch: group(ai, a => a.touch ?? "unknown", a => a.total).map(([k, v]) => ({ touch: k, orders: v.count, revenue: round(v.sum) })),
    by_evidence: group(ai, a => a.evidence ?? "unknown", a => a.total).map(([k, v]) => ({ evidence: k, orders: v.count, revenue: round(v.sum) })),
    top_products: [...productTotals.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([title, v]) => ({ title, units: v.units, revenue: round(v.revenue) })),
    weekly: [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([w, v]) => ({ week_start: w, ai_revenue: round(v.ai), total_revenue: round(v.total) })),
    candidates: { orders: candidates.length, revenue: round(candidates.reduce((s, a) => s + a.total, 0)) },
    sample_proof: ai.slice(0, 5).map(a => ({ order: a.orderName, source: label(a.source ?? ""), total: a.total, proof: a.proof }))
  };
}

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const TOUCH_WORDS: Record<string, string> = {
  first: "Found you through AI, bought later",
  last: "Came back through AI to buy",
  both: "AI at first and last visit",
  checkout: "Bought inside an AI channel"
};

const EVIDENCE_WORDS: Record<string, string> = {
  checkout_in_ai: "Order channel says AI",
  referrer: "Visit came from an AI site",
  utm: "Link carried an AI tag"
};

export function renderMarkdown(r: Report, storeName = "Your store"): string {
  const lines = [
    `# AI Sales: ${storeName}`,
    `${r.period.from} to ${r.period.to}`,
    "",
    `**AI sent ${r.ai.orders} orders worth ${money(r.ai.revenue)}, ${r.ai.share_of_revenue}% of revenue.**`,
    `AI orders average ${money(r.ai.avg_order_value)} vs ${money(r.ai.non_ai_avg_order_value)} for everything else.`,
    "",
    "## Which AI sent them",
    ...r.by_source.map(s => `- ${s.label}: ${s.orders} orders, ${money(s.revenue)}`),
    "",
    "## How shoppers used AI",
    ...r.by_touch.map(t => `- ${TOUCH_WORDS[t.touch] ?? t.touch}: ${t.orders} orders, ${money(t.revenue)}`),
    "",
    "## Products AI sells most",
    ...r.top_products.slice(0, 5).map(p => `- ${p.title}: ${p.units} units, ${money(p.revenue)}`),
    "",
    "## How we know",
    ...r.by_evidence.map(e => `- ${EVIDENCE_WORDS[e.evidence] ?? e.evidence}: ${e.orders} orders`),
    "",
    "Check any of these in Shopify:",
    ...r.sample_proof.map(p => `- Order ${p.order} (${p.source}, ${money(p.total)}): ${p.proof.join("; ")}`),
    "",
    "## Not counted, but worth watching",
    `${r.candidates.orders} orders (${money(r.candidates.revenue)}) came "direct" straight to a product page. AI links often look like this when the referrer is stripped. We don't count them as AI sales.`
  ];
  return lines.join("\n");
}
