// AI Answer Check: what an assistant tells shoppers about a store, compared with the store's own catalog.
// Browser-safe types only.

export interface CatalogSource {
  system: string;
  ref: string;
  updated?: string;
}

export interface CatalogFact {
  attribute: string;
  value: string;
  source: CatalogSource;
}

export interface CatalogProduct {
  id: string;
  title: string;
  /** Product description as plain text, when known. */
  description?: string;
  /** amount is the lowest option price; max the highest when options differ. */
  price?: { amount: number; max?: number; currency: string; source: CatalogSource };
  /** Undefined when the store does not track stock for this product. */
  stock?: { inStock: boolean; source: CatalogSource };
  facts: CatalogFact[];
  approvedClaims: string[];
  prohibitedClaims: string[];
}

export interface CatalogPolicy {
  id: string;
  title: string;
  text: string;
  source: CatalogSource;
}

export interface Catalog {
  store: { name: string; domain: string };
  /** True for the fictional sample store. Screens label demo catalogs. */
  demo: boolean;
  products: CatalogProduct[];
  policies: CatalogPolicy[];
}

/** What a question is mainly about. Every answer is still checked against everything known about its subject. */
export type QuestionFocus = "overview" | "price" | "stock" | "claim" | "policy" | (string & {});

export interface Question {
  id: string;
  subject: { kind: "product" | "policy"; id: string; title: string };
  focus: QuestionFocus;
  text: string;
}

export type ProviderId = "meta" | "openai" | "perplexity" | "gemini";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  model: string;
  /** live: answers come from the provider's official API. fixture: labeled sample answers, no API call. */
  mode: "live" | "fixture";
}

export type Severity = "high" | "medium";

export type IssueKind = "banned_claim" | "wrong_fact" | "wrong_price" | "wrong_stock" | "wrong_policy";

export interface Issue {
  kind: IssueKind;
  severity: Severity;
  /** The sentence of the answer that contains the problem. */
  said: string;
  /** What the catalog says instead. */
  truth: string;
  source: string;
  why: string;
  /** banned_claim only: the banned claims the sentence makes. */
  claims?: string[];
}

export type AnswerStatus = "consistent" | "contradiction" | "no_answer" | "error";

export interface AnswerResult {
  questionId: string;
  question: string;
  subject: string;
  provider: ProviderId;
  providerLabel: string;
  status: AnswerStatus;
  answer?: string;
  error?: string;
  issues: Issue[];
}

export interface AnswerCheckRun {
  generatedAt: string;
  /** live only when every provider in the run answered through its API. */
  mode: "live" | "fixture";
  store: { name: string; domain: string };
  demoCatalog: boolean;
  providers: ProviderInfo[];
  /** Answers received (errors included, skipped questions excluded). */
  asked: number;
  consistent: number;
  contradictions: number;
  noAnswer: number;
  errors: number;
  results: AnswerResult[];
}
