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

const NEGATOR = /^(not|no|never|without|non|nor|isn't|aren't|wasn't|isnt|arent|wasnt|it's not|isn’t|aren’t|wasn’t)$|n['’]t$/i;
const SOFTENERS = /^(fully|completely|totally|entirely|truly|really|actually|technically|100%|currently|yet|quite|very|that|longer|considered|rated|designed|meant|to|be|a|an)$/i;

/** Clause boundaries: punctuation and joining words. "isn't just X but waterproof" puts "waterproof" in its own clause. */
const CLAUSE_BREAK = /[.!?;:,\n]|\s(?:but|and|while|though|although|so|yet|however)\s/gi;

function clauseBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  let start = 0;
  for (const m of before.matchAll(CLAUSE_BREAK)) start = m.index! + m[0].length;
  return before.slice(start);
}

/**
 * True when the words just before `index` negate it: a negator directly before the phrase, optionally
 * followed by softeners ("not waterproof", "isn't fully waterproof", "is not 100% waterproof"). A negator
 * further back ("There's no question it's waterproof") does not count.
 */
function negatedAt(text: string, index: number): boolean {
  const words = clauseBefore(text, index).trim().split(/\s+/).filter(Boolean);
  while (words.length > 0 && SOFTENERS.test(words.at(-1)!)) words.pop();
  return words.length > 0 && NEGATOR.test(words.at(-1)!);
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
  // No bare "in": "12 in stock" and "2 in 1" are not lengths.
  { pattern: "inch|inches|″|\"", dimension: "length", toBase: n => n * 25.4 },
  { pattern: "(?:business |calendar )?days?", dimension: "duration", toBase: n => n },
  { pattern: "weeks?", dimension: "duration", toBase: n => n * 7 },
  { pattern: "months?", dimension: "duration", toBase: n => n * 30 },
  { pattern: "years?|yrs?", dimension: "duration", toBase: n => n * 365 }
];

const NUMBER = "(?:[-−]|minus\\s)?\\d+(?:[.,]\\d+)?";
const UNIT_ALT = UNITS.map(u => `(?:${u.pattern})`).join("|");
// "16 to 21 inches", "3-5 business days", "2-year", "45L", "-12 °C", "410 g"
const QUANTITY_RE = new RegExp(`(${NUMBER})(?:\\s*(?:to|-|–)\\s*(${NUMBER}))?[\\s-]?(${UNIT_ALT})(?![\\w])`, "gi");
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

/** `approx`: the answer hedged ("about", "roughly"), so a rounded conversion like "1 lb" for 410 g is allowed. */
function close(a: number, b: number, dimension: Dimension, approx: boolean): boolean {
  if (dimension === "temperature") return Math.abs(a - b) <= (approx ? 3 : 1.5);
  if (dimension === "money") return Math.abs(a - b) <= 0.5;
  if (dimension === "duration") return Math.abs(a - b) <= Math.max(0.5, b * 0.05);
  return Math.abs(a - b) <= Math.abs(b) * (approx ? 0.15 : 0.08);
}

const APPROX = /\b(about|around|roughly|approximately|approx|nearly|almost|under|over|just over|just under)\b|~|≈/i;

interface Known {
  quantities: Quantity[];
  truth: string;
  source: CatalogSource;
  /** The answer's clause must mention one of these for its numbers to be judged against this fact. */
  keywords?: RegExp;
  /** The fact the question asks about. If the answer never uses its keywords ("It's about 900 grams."), every number is judged. */
  focus?: boolean;
  /** Allowed values as [min, max] ranges per quantity; defaults to each quantity's value. */
  range?: [number, number];
}

/** The clause of `text` around `index`, split at punctuation and joining words. */
function clauseAt(text: string, index: number): string {
  const start = index - clauseBefore(text, index).length;
  const after = text.slice(index);
  CLAUSE_BREAK.lastIndex = 0;
  const m = [...after.matchAll(CLAUSE_BREAK)].find(x => x.index! > 0);
  return text.slice(start, m ? index + m.index! : text.length);
}

/**
 * A number in the answer is judged only against catalog facts of the same dimension whose keywords appear
 * in the same clause ("weighs 1.3 kg" against weight, not "carries loads up to 15 kg"). It is wrong when it
 * matches none of them. Numbers no fact speaks to are not judged.
 */
function numberIssues(answer: string, known: Known[], kind: Issue["kind"], severity: Issue["severity"], why: (said: string, truth: string) => string): Issue[] {
  const issues: Issue[] = [];
  const flagged = new Set<string>();
  for (const q of extractQuantities(answer)) {
    const clause = clauseAt(answer, q.index);
    const applies = (k: Known) => !k.keywords || k.keywords.test(clause) || (k.focus === true && !k.keywords.test(answer));
    const facts = known.filter(k => k.quantities.some(x => x.dimension === q.dimension) && applies(k));
    if (facts.length === 0) continue;
    const approx = APPROX.test(clause);
    const ok = facts.some(k =>
      k.range
        ? q.value >= k.range[0] - 0.5 && q.value <= k.range[1] + 0.5
        : k.quantities.some(x => x.dimension === q.dimension && close(q.value, x.value, q.dimension, approx))
    );
    if (ok || flagged.has(`${q.dimension}|${facts[0]!.truth}`)) continue;
    flagged.add(`${q.dimension}|${facts[0]!.truth}`);
    const fact = facts[0]!;
    issues.push({ kind, severity, said: sentenceAt(answer, q.index), truth: fact.truth, source: sourceText(fact.source), why: why(q.text, fact.truth) });
  }
  return issues;
}

/** Words a clause uses when it talks about a fact. Attributes not listed use the words of their own name. */
const FACT_KEYWORDS: Record<string, RegExp> = {
  weight: /\b(weigh\w*|weight|heavy|light(?:weight)?)\b/i,
  volume: /\b(liters?|litres?|capacity|volume|holds?)\b|\d\s?l\b/i,
  comfort_rating: /\b(warm\w*|comfortable (?:to|down)|comfort rating|rated|temperatures?|degrees?)\b/i,
  torso_fit: /\b(torso|fits?|adjust\w*)\b/i,
  fill_power: /\b(fill|down)\b/i,
  packed_size: /\b(pack(?:ed|s)? (?:down|size|to|into)|stuff sack)\b/i
};
const POLICY_KEYWORDS: Record<string, RegExp> = {
  returns: /\b(return\w*|send (?:it )?back|exchange\w*)\b/i,
  shipping: /\b(ship\w*|deliver\w*|arriv\w*|free|over|orders?|takes?)\b/i,
  warranty: /\b(warrant\w*|guarantee\w*|defects?|covered)\b/i
};

function keywordsFor(attribute: string): RegExp {
  const known = FACT_KEYWORDS[attribute];
  if (known) return known;
  const words = attribute.split(/[_\s-]+/).filter(w => w.length > 2).map(escape);
  return words.length ? new RegExp(`\\b(${words.join("|")})\\w*`, "i") : /./;
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

/** "back in stock next week", "once it's in stock": talks about a restock, not current stock. */
const FUTURE_STOCK = /\b(back|again|once|when|until|after|soon|restock\w*|expected|should be|will be|be)\s+(?:\S+\s+)?$/i;

function stockIssues(answer: string, p: CatalogProduct): Issue[] {
  if (!p.stock) return [];
  const phrases = p.stock.inStock ? OUT_OF_STOCK : IN_STOCK;
  for (const phrase of phrases) {
    const [at] = affirmedMentions(answer, phrase).filter(i => !FUTURE_STOCK.test(clauseBefore(answer, i)));
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
  const facts: Known[] = p.facts.map(f => ({
    quantities: extractQuantities(f.value),
    truth: f.value,
    source: f.source,
    keywords: keywordsFor(f.attribute),
    focus: f.attribute === q.focus
  }));
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
    const { amount, max, currency } = p.price;
    const fmt = (n: number) => (currency === "USD" ? `$${n.toFixed(n % 1 ? 2 : 0)}` : `${n.toFixed(n % 1 ? 2 : 0)} ${currency}`);
    const truth = max !== undefined && max > amount ? `${fmt(amount)} to ${fmt(max)}, depending on the option` : fmt(amount);
    const price: Known = {
      quantities: [{ dimension: "money", value: amount, text: "", index: 0 }],
      truth,
      source: p.price.source,
      range: [amount, max ?? amount]
    };
    issues.push(...numberIssues(answer, [price], "wrong_price", "high", (said, truth) => `AI quoted ${said}; the price is ${truth}.`));
  }
  issues.push(...stockIssues(answer, p));
  return dedupe(issues);
}

function policyIssues(answer: string, policy: CatalogPolicy): Issue[] {
  const known: Known[] = [{ quantities: extractQuantities(policy.text), truth: policy.text, source: policy.source, keywords: POLICY_KEYWORDS[policy.id] ?? keywordsFor(policy.title) }];
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
