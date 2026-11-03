// Compares one AI answer with the catalog. Plain string and number rules, no language model:
// the same answer and catalog always give the same verdict, and every issue names the catalog
// fact and source it was checked against.
import type { AnswerStatus, Catalog, CatalogPolicy, CatalogProduct, CatalogSource, Issue, Question } from "./types.ts";

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "odor-proof" also matches "odor proof" and "odorproof"; case-insensitive, whole words. */
function phrasePattern(phrase: string): RegExp {
  const body = phrase
    .trim()
    .split(/[\s-]+/)
    .map(escape)
    .join("[\\s-]?");
  return new RegExp(`(?<![\\w-])${body}(?![\\w-])`, "gi");
}

const NEGATION = /\b(not|no|never|isn't|aren't|wasn't|isnt|arent|without|nor|non)\b|n't\b|n’t\b/i;

/** True when one of the four words before `index` negates what follows ("not waterproof", "isn't fully waterproof"). */
function negatedAt(text: string, index: number): boolean {
  const before = text.slice(0, index).split(/[.!?;:,]/).pop() ?? "";
  const words = before.trim().split(/\s+/).slice(-4).join(" ");
  return NEGATION.test(words);
}

/** The sentence of `text` that contains `index`, trimmed for display. */
function sentenceAt(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(". ", index), text.lastIndexOf("! ", index), text.lastIndexOf("? ", index), text.lastIndexOf("\n", index));
  const rest = text.slice(index).search(/[.!?](\s|$)|\n/);
  const end = rest === -1 ? text.length : index + rest + 1;
  const sentence = text.slice(start === -1 ? 0 : start + 1, end).trim();
  return sentence.length > 280 ? `${sentence.slice(0, 277)}…` : sentence;
}

/** Positive (non-negated) mentions of `phrase` in `text`. */
function affirmedMentions(text: string, phrase: string): number[] {
  return [...text.matchAll(phrasePattern(phrase))].map(m => m.index!).filter(i => !negatedAt(text, i));
}

// ---------------------------------------------------------------------------------------------
// Quantities: numbers with units, normalized so "0.9 kg" and "900 g" compare equal
// ---------------------------------------------------------------------------------------------

export type Dimension = "mass" | "volume" | "temperature" | "length" | "duration" | "money";

export interface Quantity {
  dimension: Dimension;
  /** Normalized: grams, liters, °C, millimeters, days, dollars. */
  value: number;
  text: string;
  index: number;
}

const UNITS: { pattern: string; dimension: Dimension; toBase: (n: number) => number }[] = [
  { pattern: "kg|kgs|kilograms?|kilos?", dimension: "mass", toBase: n => n * 1000 },
  { pattern: "g|grams?", dimension: "mass", toBase: n => n },
  { pattern: "lbs?|pounds?", dimension: "mass", toBase: n => n * 453.592 },
  { pattern: "oz|ounces?", dimension: "mass", toBase: n => n * 28.3495 },
  { pattern: "l|liters?|litres?", dimension: "volume", toBase: n => n },
  { pattern: "ml|milliliters?|millilitres?", dimension: "volume", toBase: n => n / 1000 },
  { pattern: "°\\s?c|c|celsius|degrees celsius", dimension: "temperature", toBase: n => n },
  { pattern: "°\\s?f|f|fahrenheit|degrees fahrenheit", dimension: "temperature", toBase: n => ((n - 32) * 5) / 9 },
  { pattern: "cm|centimeters?|centimetres?", dimension: "length", toBase: n => n * 10 },
  { pattern: "mm|millimeters?|millimetres?", dimension: "length", toBase: n => n },
  { pattern: "in|inch|inches|\"", dimension: "length", toBase: n => n * 25.4 },
  { pattern: "(?:business |calendar )?days?", dimension: "duration", toBase: n => n },
  { pattern: "weeks?", dimension: "duration", toBase: n => n * 7 },
  { pattern: "months?", dimension: "duration", toBase: n => n * 30 },
  { pattern: "years?|yrs?", dimension: "duration", toBase: n => n * 365 }
];

const NUMBER = "(?:[-−]|minus\\s)?\\d+(?:[.,]\\d+)?";
const UNIT_ALT = UNITS.map(u => `(?:${u.pattern})`).join("|");
// "16 to 21 in", "3-5 business days", "2-year", "45L", "-12 °C", "410 g"
const QUANTITY_RE = new RegExp(`(${NUMBER})(?:\\s*(?:to|-|–|and)\\s*(${NUMBER}))?[\\s-]?(${UNIT_ALT})(?![\\w])`, "gi");
const MONEY_RE = /\$\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:usd|dollars)\b/gi;

const parseNumber = (s: string) => Number(s.replace(/^minus\s/i, "-").replace("−", "-").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));

/** Every number-with-unit in `text`, normalized. Ranges give both ends. */
export function extractQuantities(text: string): Quantity[] {
  const out: Quantity[] = [];
  for (const m of text.matchAll(QUANTITY_RE)) {
    const unitText = m[3]!.toLowerCase();
    const unit = UNITS.find(u => new RegExp(`^(?:${u.pattern})$`, "i").test(unitText));
    if (!unit) continue;
    for (const n of [m[1], m[2]]) {
      if (n === undefined) continue;
      const value = parseNumber(n);
      if (Number.isFinite(value)) out.push({ dimension: unit.dimension, value: unit.toBase(value), text: m[0].trim(), index: m.index! });
    }
  }
  for (const m of text.matchAll(MONEY_RE)) {
    const value = parseNumber(m[1] ?? m[2]!);
    if (Number.isFinite(value)) out.push({ dimension: "money", value, text: m[0].trim(), index: m.index! });
  }
  return out;
}

function close(a: number, b: number, dimension: Dimension): boolean {
  if (dimension === "temperature") return Math.abs(a - b) <= 1.5;
  if (dimension === "money") return Math.abs(a - b) <= 0.5;
  if (dimension === "duration") return Math.abs(a - b) <= Math.max(0.5, b * 0.05);
  return Math.abs(a - b) <= Math.abs(b) * 0.08;
}

interface Known {
  quantities: Quantity[];
  truth: string;
  source: CatalogSource;
}

/**
 * For each dimension the catalog states, any number the answer gives in that dimension must match
 * one of the catalog's numbers. Numbers in dimensions the catalog never states are not judged.
 */
function numberIssues(answer: string, known: Known[], kind: Issue["kind"], severity: Issue["severity"], why: (said: string, truth: string) => string): Issue[] {
  const issues: Issue[] = [];
  const said = extractQuantities(answer);
  const dimensions = new Set(known.flatMap(k => k.quantities.map(q => q.dimension)));
  for (const dimension of dimensions) {
    const facts = known.filter(k => k.quantities.some(q => q.dimension === dimension));
    const allowed = facts.flatMap(k => k.quantities.filter(q => q.dimension === dimension).map(q => q.value));
    const wrong = said.find(q => q.dimension === dimension && !allowed.some(v => close(q.value, v, dimension)));
    if (!wrong) continue;
    const fact = facts[0]!;
    issues.push({ kind, severity, said: sentenceAt(answer, wrong.index), truth: fact.truth, source: sourceText(fact.source), why: why(wrong.text, fact.truth) });
  }
  return issues;
}

export function sourceText(s: CatalogSource): string {
  const system = { shopify: "Shopify", notion: "Notion", gorgias: "Gorgias" }[s.system] ?? s.system;
  const updated = s.updated ? `, updated ${new Date(`${s.updated.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}` : "";
  return `${s.ref} (${system})${updated}`;
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

function bannedClaimIssues(answer: string, p: CatalogProduct): Issue[] {
  // Group by sentence, so "antibacterial and odor-proof" is one finding naming both claims.
  const bySentence = new Map<string, string[]>();
  for (const claim of p.prohibitedClaims) {
    const [at] = affirmedMentions(answer, claim);
    if (at === undefined) continue;
    const said = sentenceAt(answer, at);
    bySentence.set(said, [...(bySentence.get(said) ?? []), claim]);
  }
  const approved = p.approvedClaims.length > 0 ? ` Approved claims: ${p.approvedClaims.join(", ")}.` : "";
  return [...bySentence].map(([said, claims]) => {
    // Explain with the fact a claim contradicts, when there is one (e.g. water_resistance for "waterproof").
    const related = p.facts.find(f => claims.some(c => phrasePattern(c).test(f.value)));
    const quoted = claims.map(c => `“${c}”`);
    const list = quoted.length === 1 ? `${quoted[0]} is a claim` : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)} are claims`;
    return {
      kind: "banned_claim" as const,
      severity: "high" as const,
      said,
      truth: related ? related.value : `Not an approved claim.${approved}`,
      source: related ? sourceText(related.source) : "Your banned claims list",
      why: `${list} you’ve banned for this product. Shoppers who buy on a claim you don’t make are likely to return it.`
    };
  });
}

const IN_STOCK = ["in stock", "available now", "available to order", "ready to ship", "ships today"];
const OUT_OF_STOCK = ["out of stock", "sold out", "unavailable", "back-ordered", "backordered"];

function stockIssues(answer: string, p: CatalogProduct): Issue[] {
  if (!p.stock) return [];
  const phrases = p.stock.inStock ? OUT_OF_STOCK : IN_STOCK;
  for (const phrase of phrases) {
    const [at] = affirmedMentions(answer, phrase);
    if (at === undefined) continue;
    return [
      {
        kind: "wrong_stock",
        severity: "medium",
        said: sentenceAt(answer, at),
        truth: p.stock.inStock ? "In stock." : "Out of stock.",
        source: sourceText(p.stock.source),
        why: p.stock.inStock ? "AI is telling shoppers they can’t buy something you have in stock." : "Shoppers sent to an out-of-stock product usually leave without buying anything."
      }
    ];
  }
  return [];
}

function productIssues(answer: string, q: Question, p: CatalogProduct): Issue[] {
  const facts: Known[] = p.facts.map(f => ({ quantities: extractQuantities(f.value), truth: f.value, source: f.source }));
  const issues = [
    ...bannedClaimIssues(answer, p),
    ...numberIssues(
      answer,
      facts.map(k => ({ ...k, quantities: k.quantities.filter(x => x.dimension !== "money") })),
      "wrong_fact",
      "high",
      (said, truth) => `AI said ${said}, but your catalog says ${truth}.`
    )
  ];
  // Prices are only judged on price questions: product answers often quote other amounts, like a free-shipping threshold.
  if (p.price && q.focus === "price") {
    const price = { quantities: [{ dimension: "money" as const, value: p.price.amount, text: "", index: 0 }], truth: `$${p.price.amount}`, source: p.price.source };
    issues.push(...numberIssues(answer, [price], "wrong_price", "high", (said, truth) => `AI quoted ${said}; the price is ${truth}.`));
  }
  issues.push(...stockIssues(answer, p));
  return dedupe(issues);
}

function policyIssues(answer: string, policy: CatalogPolicy): Issue[] {
  const known: Known[] = [{ quantities: extractQuantities(policy.text), truth: policy.text, source: policy.source }];
  return numberIssues(answer, known, "wrong_policy", "medium", said => `AI said ${said}, which doesn’t match your published ${policy.title.toLowerCase()} policy.`);
}

/** One issue per sentence and kind, so a repeated mistake is reported once. */
function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter(i => {
    const key = `${i.kind}|${i.said}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const NO_ANSWER = /\b(i (don'?t|do not) (have|know)|i'?m not (sure|aware)|i (couldn'?t|could not|can'?t|cannot) find|no (information|details) (about|on)|not familiar with)\b/i;

export interface Comparison {
  status: Exclude<AnswerStatus, "error">;
  issues: Issue[];
}

/** Checks one answer to `question` against what `catalog` says about the question's subject. */
export function compareAnswer(answer: string, question: Question, catalog: Catalog): Comparison {
  const text = answer.trim();
  let issues: Issue[] = [];
  if (question.subject.kind === "product") {
    const product = catalog.products.find(p => p.id === question.subject.id);
    if (product) issues = productIssues(text, question, product);
  } else {
    const policy = catalog.policies.find(p => p.id === question.subject.id);
    if (policy) issues = policyIssues(text, policy);
  }
  if (issues.length > 0) return { status: "contradiction", issues };
  if (!text || NO_ANSWER.test(text)) return { status: "no_answer", issues: [] };
  return { status: "consistent", issues: [] };
}
