// Plain words and formatting shared by every screen (web, Shopify app, weekly email).
// Same wording as the engine's markdown report.

/** Default report window. read_orders covers the last 60 days; longer needs read_all_orders. */
export const REPORT_DAYS = 60;

export const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export const TOUCH_WORDS: Record<string, string> = {
  first: "Found you through AI, bought later",
  last: "Came back through AI to buy",
  both: "AI at first and last visit",
  checkout: "Bought inside an AI channel"
};

export const EVIDENCE_WORDS: Record<string, string> = {
  checkout_in_ai: "Order channel says AI",
  referrer: "Visit came from an AI site",
  utm: "Link carried an AI tag"
};
