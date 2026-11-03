import type { Attribution, Evidence, Order, Signature, Visit } from "./types.ts";

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string, patterns: string[]): boolean {
  return patterns.some(p => host === p || host.endsWith(`.${p}`));
}

/** utm_source can arrive parsed, or only inside the landing URL when the parser missed it. */
export function utmSourceOf(visit: Visit): string | null {
  if (visit.utmSource) return visit.utmSource.toLowerCase();
  if (!visit.landingPage) return null;
  try {
    const url = new URL(visit.landingPage, "https://store.invalid");
    return url.searchParams.get("utm_source")?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

interface VisitMatch {
  signature: Signature;
  evidence: Evidence;
  proof: string;
}

export function matchVisit(visit: Visit | null | undefined, signatures: Signature[], which: "first" | "last"): VisitMatch | null {
  if (!visit) return null;
  const host = hostOf(visit.referrerUrl);
  if (host) {
    const sig = signatures.find(s => hostMatches(host, s.referrer_hosts));
    if (sig) return { signature: sig, evidence: "referrer", proof: `${which} visit referrer was ${host}` };
  }
  const utm = utmSourceOf(visit);
  if (utm) {
    const sig = signatures.find(s => s.utm_sources.includes(utm));
    if (sig) return { signature: sig, evidence: "utm", proof: `${which} visit had utm_source=${utm}` };
  }
  return null;
}

function isProductLanding(visit: Visit | null | undefined): boolean {
  return Boolean(visit?.landingPage && /\/products\//.test(visit.landingPage));
}

function isDirect(visit: Visit | null | undefined): boolean {
  if (!visit) return false;
  const type = (visit.sourceType ?? visit.source ?? "").toLowerCase();
  return !visit.referrerUrl && !utmSourceOf(visit) && (type === "" || type.includes("direct"));
}

export function classifyOrder(order: Order, signatures: Signature[]): Attribution {
  const base = { orderId: order.id, orderName: order.name, createdAt: order.createdAt, total: order.total };

  // 1. Placed through an AI channel: strongest evidence.
  const channel = order.channel?.toLowerCase() ?? "";
  if (channel) {
    const sig = signatures.find(s => s.channel_patterns.some(p => channel.includes(p)));
    if (sig) {
      return { ...base, isAI: true, source: sig.id, touch: "checkout", evidence: "checkout_in_ai", proof: [`order channel is "${order.channel}"`] };
    }
  }

  // 2. Visits from an AI source. Prefer first touch (discovery); note when both visits agree.
  const first = matchVisit(order.firstVisit, signatures, "first");
  const last = matchVisit(order.lastVisit, signatures, "last");
  if (first || last) {
    const primary = (first ?? last)!;
    const touch = first && last ? "both" : first ? "first" : "last";
    const evidence = first?.evidence === "referrer" || last?.evidence === "referrer" ? "referrer" : primary.evidence;
    return {
      ...base,
      isAI: true,
      source: primary.signature.id,
      touch,
      evidence,
      proof: [first?.proof, last?.proof].filter((p): p is string => Boolean(p))
    };
  }

  // 3. Possible hidden AI traffic: direct visit straight to a product page. Reported, never counted.
  if (isDirect(order.firstVisit) && isProductLanding(order.firstVisit)) {
    return {
      ...base,
      isAI: false,
      source: null,
      touch: null,
      evidence: "candidate",
      proof: [`first visit was direct to ${order.firstVisit?.landingPage}, a pattern that often hides AI links`]
    };
  }

  return { ...base, isAI: false, source: null, touch: null, evidence: null, proof: [] };
}

export function classifyOrders(orders: Order[], signatures: Signature[]): Attribution[] {
  return orders.map(o => classifyOrder(o, signatures));
}
