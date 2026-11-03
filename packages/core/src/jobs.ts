// Run report as a background job. Starting a run creates its row ('running') and returns at once;
// fetching, classifying and storing happen afterwards, so a large store never hits a request timeout.
// Every run ends as 'done' or 'failed': errors are caught and recorded, and runs left 'running' by a
// process that died are failed by failStaleRuns.
import type { GraphqlRunner } from "../../attribution/src/shopify.ts";
import type { Order } from "../../attribution/src/types.ts";
import { completeReportRun, createReportRun, failReportRun, touchReportRun, type Db, type ShopInfo } from "./db.ts";
import type { AiSalesView } from "./types.ts";

export interface RetryOptions {
  /** Retries after the first attempt. Default 5. */
  retries?: number;
  /** First wait in milliseconds, doubled each retry. Default 1000. */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type GraphqlBody = Awaited<ReturnType<GraphqlRunner>>;

/** Shopify signals throttling with a THROTTLED GraphQL error, or HTTP 429 (which runners surface as errors). */
export function isThrottled(result: { body?: GraphqlBody; error?: unknown }): boolean {
  const errors = (result.body?.errors ?? []) as { message?: string; extensions?: { code?: string } }[];
  if (errors.some(e => e.extensions?.code === "THROTTLED" || /throttl/i.test(e.message ?? ""))) return true;
  if (result.error === undefined) return false;
  const e = result.error as { message?: string; status?: number; response?: { code?: number } };
  return e.status === 429 || e.response?.code === 429 || /throttl|rate limit|\b429\b|too many requests/i.test(e.message ?? String(result.error));
}

/** Wraps a GraphQL runner so a throttled page is retried with exponential backoff instead of failing the run. */
export function retryingRunner(run: GraphqlRunner, opts: RetryOptions = {}): GraphqlRunner {
  const retries = opts.retries ?? 5;
  const base = opts.baseDelayMs ?? 1000;
  const sleep = opts.sleep ?? defaultSleep;
  return async (query, variables) => {
    for (let attempt = 0; ; attempt++) {
      let body: GraphqlBody | undefined;
      let error: unknown;
      try {
        body = await run(query, variables);
      } catch (e) {
        error = e;
      }
      const throttled = isThrottled({ body, error });
      if (!throttled || attempt >= retries) {
        if (error !== undefined) throw error;
        return body!;
      }
      await sleep(base * 2 ** attempt);
    }
  };
}

export interface ReportJob {
  runId: string;
  /** Settles when the run is stored ('done') or recorded as 'failed'. Never rejects. */
  done: Promise<{ status: "done"; view: AiSalesView } | { status: "failed"; error: string }>;
}

/** Heartbeats are written at most this often while a run fetches. */
const HEARTBEAT_EVERY_MS = 30_000;

/**
 * Creates the run and returns immediately. The orders are fetched and stored in the background.
 * `fetchOrders` is injected, so the Shopify app passes its Admin API client and tests pass a fake; it calls
 * `progress()` as pages arrive so the run's heartbeat stays fresh. Throws RunInProgressError if the shop
 * already has a running report.
 */
export async function startReportJob(
  db: Db,
  input: { shop: ShopInfo; days: number; fetchOrders: (progress: () => void) => Promise<Order[]>; now?: () => Date }
): Promise<ReportJob> {
  const now = input.now ?? (() => new Date());
  const { runId, shopId } = await createReportRun(db, { shop: input.shop, days: input.days, now: now() });
  let lastBeat = Date.now();
  const progress = () => {
    if (Date.now() - lastBeat < HEARTBEAT_EVERY_MS) return;
    lastBeat = Date.now();
    touchReportRun(db, runId, now()).catch(error => console.error("Recording report progress failed", error));
  };
  const done = (async () => {
    try {
      const orders = await input.fetchOrders(progress);
      const view = await completeReportRun(db, { runId, shopId, shop: input.shop, orders, now: now() });
      return { status: "done" as const, view };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await failReportRun(db, runId, message);
      } catch (inner) {
        console.error("Recording the failed report run also failed", inner);
      }
      return { status: "failed" as const, error: message };
    }
  })();
  return { runId, done };
}
