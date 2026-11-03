// Weekly Fix: one suggested change to the store per week, chosen by fixed rules from stored data, applied
// and undone through the Shopify Admin API, with before/after and holdout products recorded so the effect
// can be measured. No model chooses the fix or touches the revenue math; a model may only reword the
// explanation (explainFix), and the template text is used whenever it can't.
import type { GraphqlRunner } from "../../attribution/src/shopify.ts";
import type { AnswerCheckRun, Catalog, Issue } from "./answer-check/types.ts";
import { META_DEFAULT_BASE_URL, META_DEFAULT_MODEL, readMetaAnswer, type ProviderEnv } from "./answer-check/providers.ts";
import type { AiSalesView } from "./types.ts";

/** The AI Sales numbers a fix is chosen from: the report period and AI revenue per product. */
export type SalesSnapshot = Pick<AiSalesView["report"], "period" | "top_products">;

export interface FixSuggestion {
  /** Stable for the same rule, product and field, so the same suggestion isn't applied twice. */
  key: string;
  rule: "clarify_contradicted_facts";
  productId: string;
  productTitle: string;
  field: "description_top";
  /** The text added at the top of the product description. */
  addition: string;
  evidence: {
    aiRevenue: number;
    aiUnits: number;
    periodDays: number;
    findings: { provider: string; question: string; said: string; truth: string; source: string; kind: Issue["kind"] }[];
  };
  /** AI-selling products left unchanged this week, to compare against. */
  holdouts: { title: string; aiRevenue: number }[];
  explanation: string;
  explanationBy: "template" | "meta";
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  weight: "Weight",
  water_resistance: "Water resistance",
  comfort_rating: "Warmth",
  volume: "Volume",
  material: "Material",
  fill_power: "Fill",
  torso_fit: "Torso fit",
  care: "Care",
  packed_size: "Packed size"
};
const label = (attribute: string) => ATTRIBUTE_LABELS[attribute] ?? attribute.replace(/[_-]+/g, " ").replace(/^\w/, c => c.toUpperCase());
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;

/**
 * The rule: among products AI is already selling (AI Sales top products), take the one with the most AI
 * revenue that Answer Check found a banned claim or a wrong spec fact on, and add the catalog's own facts
 * to the top of its description. Ties go to the product title. Returns null when no product qualifies.
 */
export function suggestFix(input: { sales: SalesSnapshot; answerCheck: AnswerCheckRun; catalog: Catalog }): FixSuggestion | null {
  const { answerCheck, catalog } = input;
  const report = input.sales;
  const sales = new Map(report.top_products.map(p => [p.title.toLowerCase(), p]));
  const candidates = catalog.products
    .map(product => {
      const sold = sales.get(product.title.toLowerCase());
      const results = answerCheck.results.filter(
        r => r.status === "contradiction" && r.subject === product.title && r.issues.some(i => i.kind === "banned_claim" || i.kind === "wrong_fact")
      );
      // Lines grounded in the catalog's own facts: a wrong fact, or a banned claim that contradicts a fact.
      const facts = product.facts.filter(f => results.some(r => r.issues.some(i => (i.kind === "wrong_fact" || i.kind === "banned_claim") && i.truth === f.value)));
      const lines = facts.map(f => sentence(`${label(f.attribute)}: ${f.value}`));
      if (lines.length > 0) {
        // Banned claims no fact speaks to are stated plainly as "Not …", once the description already carries a fact.
        const loose = product.prohibitedClaims.filter(c => results.some(r => r.issues.some(i => i.kind === "banned_claim" && i.why.includes(`“${c}”`) && !facts.some(f => f.value === i.truth))));
        for (const c of loose) lines.push(sentence(`Not ${c}`));
      }
      return { product, sold, results, lines };
    })
    .filter(c => c.sold && c.sold.revenue > 0 && c.lines.length > 0)
    .sort((a, b) => b.sold!.revenue - a.sold!.revenue || a.product.title.localeCompare(b.product.title));

  const pick = candidates[0];
  if (!pick) return null;
  const periodDays = days(report.period.from, report.period.to);
  const holdouts = report.top_products
    .filter(p => p.title !== pick.product.title && p.revenue > 0)
    .slice(0, 2)
    .map(p => ({ title: p.title, aiRevenue: p.revenue }));
  const findings = pick.results.flatMap(r =>
    r.issues
      .filter(i => i.kind === "banned_claim" || i.kind === "wrong_fact")
      .map(i => ({ provider: r.providerLabel, question: r.question, said: i.said, truth: i.truth, source: i.source, kind: i.kind }))
  );
  // Findings backed by a catalog fact first: they make the clearest "AI said X, your catalog says Y".
  const backed = (f: { truth: string }) => (pick.product.facts.some(x => x.value === f.truth) ? 0 : 1);
  findings.sort((a, b) => backed(a) - backed(b));
  const suggestion: FixSuggestion = {
    key: `clarify_contradicted_facts:${pick.product.id}:description_top`,
    rule: "clarify_contradicted_facts",
    productId: pick.product.id,
    productTitle: pick.product.title,
    field: "description_top",
    addition: pick.lines.join(" "),
    evidence: { aiRevenue: pick.sold!.revenue, aiUnits: pick.sold!.units, periodDays, findings },
    holdouts,
    explanation: "",
    explanationBy: "template"
  };
  suggestion.explanation = templateExplanation(suggestion);
  return suggestion;
}

export function templateExplanation(s: FixSuggestion): string {
  const f = s.evidence.findings[0]!;
  const held = s.holdouts.length ? ` ${s.holdouts.map(h => h.title).join(" and ")} stay unchanged, so next week's comparison shows the real effect.` : "";
  return (
    `AI assistants sent ${money(s.evidence.aiRevenue)} of ${s.productTitle} sales in the last ${s.evidence.periodDays} days, ` +
    `but ${f.provider} told a shopper “${f.said}” Your catalog says ${f.truth} (${f.source}). ` +
    `Putting your own facts at the top of the description gives AI the right answer where it reads first.${held}`
  );
}

/**
 * Asks Meta Llama to reword the explanation in plain words. The suggestion itself (product, change, numbers)
 * is fixed before this runs and is never changed. Without META_API_KEY, or on any error, the template stays.
 */
export async function explainFix(s: FixSuggestion, env: ProviderEnv = process.env, opts: { fetch?: typeof fetch } = {}): Promise<FixSuggestion> {
  const key = env.META_API_KEY?.trim();
  if (!key) return s;
  try {
    const res = await (opts.fetch ?? fetch)(`${(env.META_API_BASE_URL || META_DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.META_MODEL || META_DEFAULT_MODEL,
        temperature: 0,
        max_completion_tokens: 200,
        messages: [
          {
            role: "system",
            content:
              "Rewrite the note for a store owner in two or three short, plain sentences. Keep every number, product name, quote and source exactly as written. Add nothing new."
          },
          { role: "user", content: s.explanation }
        ]
      }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!res.ok) return s;
    const text = readMetaAnswer(await res.json()).trim();
    // Keep the rewrite only if it kept the facts it was given.
    const kept = [money(s.evidence.aiRevenue), s.productTitle].every(t => text.includes(t));
    return text && kept ? { ...s, explanation: text, explanationBy: "meta" } : s;
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------------------------
// Apply and undo through the Admin API
// ---------------------------------------------------------------------------------------------

/** The store operations Weekly Fix needs. Shopify's implementation is shopifyProductAdmin; tests pass a mock. */
export interface ProductAdmin {
  getDescription(productId: string): Promise<string>;
  setDescription(productId: string, html: string): Promise<void>;
}

/** Live store writes are off unless CENTURION_STORE_WRITES=on (and the app has write_products). */
export const storeWritesEnabled = (env: ProviderEnv = process.env) => env.CENTURION_STORE_WRITES === "on";

export class StoreWritesOffError extends Error {
  constructor() {
    super("Live store writes are off. Set CENTURION_STORE_WRITES=on (and grant write_products) to apply fixes to the store.");
    this.name = "StoreWritesOffError";
  }
}

export class UndoConflictError extends Error {
  constructor() {
    super("The description was edited after the fix was applied, so undo would overwrite those edits. Nothing was changed.");
    this.name = "UndoConflictError";
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const additionHtml = (s: FixSuggestion) => `<p data-centurion-fix="${escapeHtml(s.key)}">${escapeHtml(s.addition)}</p>`;

export function shopifyProductAdmin(run: GraphqlRunner): ProductAdmin {
  return {
    async getDescription(productId) {
      const res = await run(`query CenturionProduct($id: ID!) { product(id: $id) { descriptionHtml } }`, { id: productId });
      if (res.errors?.length) throw new Error(`Shopify product query failed: ${res.errors.map(e => e.message).join("; ")}`);
      const html = res.data?.product?.descriptionHtml;
      if (typeof html !== "string") throw new Error(`Product ${productId} was not found.`);
      return html;
    },
    async setDescription(productId, html) {
      const res = await run(
        `mutation CenturionFix($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id } userErrors { field message } } }`,
        { product: { id: productId, descriptionHtml: html } }
      );
      if (res.errors?.length) throw new Error(`Shopify productUpdate failed: ${res.errors.map(e => e.message).join("; ")}`);
      const userErrors = res.data?.productUpdate?.userErrors ?? [];
      if (userErrors.length) throw new Error(`Shopify rejected the change: ${userErrors.map((e: { message: string }) => e.message).join("; ")}`);
    }
  };
}

export interface FixBaseline {
  periodDays: number;
  /** AI revenue per product in the report the fix was chosen from. */
  product: { title: string; aiRevenue: number };
  holdouts: { title: string; aiRevenue: number }[];
}

export interface AppliedFix {
  suggestion: FixSuggestion;
  beforeHtml: string;
  afterHtml: string;
  baseline: FixBaseline;
  appliedAt: string;
}

/** Adds the suggestion's text to the top of the product description and returns what to record. Never runs with writes off. */
export async function applyFix(admin: ProductAdmin, s: FixSuggestion, opts: { writesEnabled: boolean; now?: Date }): Promise<AppliedFix> {
  if (!opts.writesEnabled) throw new StoreWritesOffError();
  const beforeHtml = await admin.getDescription(s.productId);
  if (beforeHtml.includes(`data-centurion-fix="${escapeHtml(s.key)}"`)) throw new Error("This fix is already on the product description.");
  const afterHtml = `${additionHtml(s)}\n${beforeHtml}`;
  await admin.setDescription(s.productId, afterHtml);
  return {
    suggestion: s,
    beforeHtml,
    afterHtml,
    baseline: { periodDays: s.evidence.periodDays, product: { title: s.productTitle, aiRevenue: s.evidence.aiRevenue }, holdouts: s.holdouts },
    appliedAt: (opts.now ?? new Date()).toISOString()
  };
}

/** Restores the description from before the fix, only if nobody has edited it since. */
export async function undoFix(admin: ProductAdmin, fix: Pick<AppliedFix, "suggestion" | "beforeHtml" | "afterHtml">, opts: { writesEnabled: boolean }): Promise<void> {
  if (!opts.writesEnabled) throw new StoreWritesOffError();
  const current = await admin.getDescription(fix.suggestion.productId);
  if (current !== fix.afterHtml) throw new UndoConflictError();
  await admin.setDescription(fix.suggestion.productId, fix.beforeHtml);
}

// ---------------------------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------------------------

export interface FixMeasurement {
  /** AI revenue per day, before (baseline report) and after (a report from after the fix). */
  product: { before: number; after: number; change: number };
  holdouts: { before: number; after: number; change: number };
  /** Change for the fixed product minus the holdouts' average change, in AI revenue per day. */
  lift: number;
}

/**
 * Difference in differences: how much the fixed product's AI revenue per day moved, beyond how much the
 * unchanged holdout products moved over the same time. Plain arithmetic on AI Sales report numbers.
 */
export function measureFix(baseline: FixBaseline, after: AiSalesView): FixMeasurement {
  const afterDays = days(after.report.period.from, after.report.period.to);
  const revenue = (title: string) => after.report.top_products.find(p => p.title === title)?.revenue ?? 0;
  const perDay = (n: number, d: number) => Math.round((n / d) * 100) / 100;
  const product = { before: perDay(baseline.product.aiRevenue, baseline.periodDays), after: perDay(revenue(baseline.product.title), afterDays) };
  const n = baseline.holdouts.length || 1;
  const hBefore = perDay(baseline.holdouts.reduce((s, h) => s + h.aiRevenue, 0) / n, baseline.periodDays);
  const hAfter = perDay(baseline.holdouts.reduce((s, h) => s + revenue(h.title), 0) / n, afterDays);
  const pChange = Math.round((product.after - product.before) * 100) / 100;
  const hChange = baseline.holdouts.length ? Math.round((hAfter - hBefore) * 100) / 100 : 0;
  return {
    product: { ...product, change: pChange },
    holdouts: { before: baseline.holdouts.length ? hBefore : 0, after: baseline.holdouts.length ? hAfter : 0, change: hChange },
    lift: Math.round((pChange - hChange) * 100) / 100
  };
}
