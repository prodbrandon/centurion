import { writeFileSync } from "node:fs";
import { utmSourceOf } from "./classify.ts";
import type { Order, SignatureFile } from "./types.ts";

// The signature list is the seed of the dataset. Discovery surfaces referrers and utm tags we
// don't know yet, ranked by the orders they drove, so new AI sources (a new assistant, a new
// agent browser) are caught within days. A person approves each one; nothing is added silently.

const NOT_AI = [
  "google.", "bing.com", "duckduckgo.com", "yahoo.com", "facebook.com", "instagram.com", "l.instagram.com",
  "tiktok.com", "pinterest.com", "youtube.com", "reddit.com", "t.co", "x.com", "klaviyo", "mailchi.mp",
  "shop.app", "myshopify.com", "paypal.com", "afterpay", "klarna"
];

const NOT_AI_UTM = [
  "google", "bing", "facebook", "fb", "meta_ads", "instagram", "ig", "tiktok", "pinterest", "youtube", "reddit",
  "twitter", "x", "klaviyo", "mailchimp", "email", "newsletter", "sms", "attentive", "postscript", "shop_app",
  "affiliate", "impact", "shareasale", "linktree"
];

export interface Candidate {
  kind: "referrer_host" | "utm_source";
  value: string;
  orders: number;
  revenue: number;
  example_order: string;
}

export function discoverCandidates(orders: Order[], file: SignatureFile, storeHost?: string): Candidate[] {
  const knownHosts = file.signatures.flatMap(s => s.referrer_hosts);
  const knownUtm = file.signatures.flatMap(s => s.utm_sources);
  const tally = new Map<string, Candidate>();

  const add = (kind: Candidate["kind"], value: string, order: Order) => {
    const key = `${kind}:${value}`;
    const cur = tally.get(key) ?? { kind, value, orders: 0, revenue: 0, example_order: order.name };
    cur.orders += 1;
    cur.revenue = Math.round((cur.revenue + order.total) * 100) / 100;
    tally.set(key, cur);
  };

  for (const o of orders) {
    const seen = new Set<string>(); // count each source once per order, even if both visits share it
    for (const v of [o.firstVisit, o.lastVisit]) {
      if (!v) continue;
      if (v.referrerUrl) {
        try {
          const host = new URL(v.referrerUrl).hostname.toLowerCase();
          const known = knownHosts.some(h => host === h || host.endsWith(`.${h}`));
          const ignored = NOT_AI.some(n => host.includes(n)) || (storeHost && host.includes(storeHost));
          if (!known && !ignored && !seen.has(`r:${host}`)) {
            seen.add(`r:${host}`);
            add("referrer_host", host, o);
          }
        } catch {
          /* unparseable referrer: skip */
        }
      }
      const utm = utmSourceOf(v);
      if (utm && !knownUtm.includes(utm) && !NOT_AI_UTM.includes(utm) && !seen.has(`u:${utm}`)) {
        seen.add(`u:${utm}`);
        add("utm_source", utm, o);
      }
    }
  }
  return [...tally.values()].sort((a, b) => b.revenue - a.revenue);
}

/** Adds an approved candidate to the signature file, recording who approved it and when. */
export function promoteSignature(
  file: SignatureFile,
  path: string,
  opts: { id: string; label: string; vendor: string; host?: string; utm?: string; approvedBy: string }
): SignatureFile {
  const today = new Date().toISOString().slice(0, 10);
  const existing = file.signatures.find(s => s.id === opts.id);
  if (existing) {
    if (opts.host && !existing.referrer_hosts.includes(opts.host)) existing.referrer_hosts.push(opts.host);
    if (opts.utm && !existing.utm_sources.includes(opts.utm)) existing.utm_sources.push(opts.utm);
  } else {
    file.signatures.push({
      id: opts.id,
      label: opts.label,
      vendor: opts.vendor,
      referrer_hosts: opts.host ? [opts.host] : [],
      utm_sources: opts.utm ? [opts.utm] : [],
      channel_patterns: [],
      added: today,
      added_by: `discovered, approved by ${opts.approvedBy}`
    });
  }
  const [date, n] = file.version.split(".");
  file.version = date === today ? `${today}.${Number(n ?? 0) + 1}` : `${today}.1`;
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  return file;
}
