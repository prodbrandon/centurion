// Agent Checkout Test: what a shopping agent did on a storefront, step by step. Browser-safe types only.
// The worker lives in packages/checkout-test; runs are stored in checkout_runs (the failure corpus).

/** passed: no trouble. slowed: the agent got through, with trouble. blocked: the agent stopped here. */
export type CheckoutStepStatus = "passed" | "slowed" | "blocked";

export interface CheckoutStep {
  n: number;
  title: string;
  status: CheckoutStepStatus;
  detail: string;
  /** What the store can change so agents get through. */
  hint?: string;
  ms: number;
  url: string;
}

export interface CheckoutRunResult {
  startedAt: string;
  finishedAt: string;
  /** test_page: the local test store, never a real shop. storefront: a real store's public pages. */
  target: { url: string; kind: "test_page" | "storefront" };
  agent: string;
  query: string | null;
  result: "reached_checkout" | "blocked";
  /** The step number that blocked the agent, or null when it reached checkout. */
  failedStep: number | null;
  /** Steps that slowed or blocked the agent. */
  problems: number;
  steps: CheckoutStep[];
  /** Local path of the run's video. Videos are kept out of git and out of the database. */
  videoPath: string | null;
  /** Requests the payment guard stopped ("POST /pay"). */
  blockedRequests: string[];
}
