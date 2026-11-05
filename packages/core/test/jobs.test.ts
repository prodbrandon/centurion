// Run report as a background job, on PGlite with the real migrations and an injected order fetcher.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { Order } from "../../attribution/src/types.ts";
import {
  buildView,
  currentSignatures,
  failStaleRuns,
  fetchOrdersWith,
  isThrottled,
  latestReportRun,
  loadLatestView,
  retryingRunner,
  RunInProgressError,
  startReportJob,
  touchReportRun,
  type Db,
  type GraphqlRunner,
  type Queryable
} from "../src/server.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sample: Order[] = JSON.parse(readFileSync(resolve(root, "packages/attribution/data/sample-orders.json"), "utf8"));
const SHOP = { domain: "jobs-dev.myshopify.com", name: "Jobs Dev", currency: "USD" };

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  const dir = resolve(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(resolve(dir, f), "utf8"));
  const wrap = (t: { query: PGlite["query"] }): Queryable => ({
    query: async <T>(text: string, params: unknown[] = []) => (await t.query<T>(text, params as any[])).rows
  });
  return { ...wrap(pg), transaction: fn => pg.transaction(tx => fn(wrap(tx))) };
}

const runRow = async (db: Queryable, id: string) =>
  (await db.query<{ status: string; error: string | null; finished_at: unknown }>(`select status, error, finished_at from runs where id = $1`, [id]))[0]!;

/** A fetcher the test releases by hand, so it can look at the run while the fetch is in flight. */
function gate<T>() {
  let release!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    release = res;
    fail = rej;
  });
  return { promise, release, fail };
}

test("a report job is 'running' while it fetches and 'done' afterwards, with the same view as a direct build", async () => {
  const db = await freshDb();
  const orders = sample.slice(0, 300);
  const g = gate<Order[]>();
  const now = new Date("2026-10-23T12:00:00Z");
  const job = await startReportJob(db, { shop: SHOP, days: 90, fetchOrders: () => g.promise, now: () => now });

  assert.equal((await runRow(db, job.runId)).status, "running");
  assert.equal((await latestReportRun(db, SHOP.domain))!.status, "running");
  assert.equal(await loadLatestView(db, SHOP.domain), null, "nothing is shown until the run is done");

  g.release(orders);
  const result = await job.done;
  assert.equal(result.status, "done");
  const row = await runRow(db, job.runId);
  assert.equal(row.status, "done");
  assert.ok(row.finished_at);
  const direct = buildView({ orders, file: currentSignatures, store: { name: SHOP.name, domain: SHOP.domain }, generatedAt: now.toISOString() });
  assert.deepEqual(await loadLatestView(db, SHOP.domain), direct);
  assert.equal((await latestReportRun(db, SHOP.domain))!.status, "done");
});

test("a fetch that throws leaves the run 'failed' with the error, never stuck in 'running'", async () => {
  const db = await freshDb();
  const job = await startReportJob(db, {
    shop: SHOP,
    days: 60,
    fetchOrders: async () => {
      throw new Error("Shopify GraphQL error: Access denied for orders field.");
    }
  });
  const result = await job.done; // never rejects
  assert.deepEqual(result, { status: "failed", error: "Shopify GraphQL error: Access denied for orders field." });
  const row = await runRow(db, job.runId);
  assert.equal(row.status, "failed");
  assert.match(row.error!, /Access denied/);
  assert.ok(row.finished_at);
  assert.equal((await latestReportRun(db, SHOP.domain))!.status, "failed");
});

test("a failure while storing also ends 'failed'", async () => {
  const db = await freshDb();
  const broken = [{ ...sample[0]!, total: Number.NaN }];
  const job = await startReportJob(db, { shop: SHOP, days: 60, fetchOrders: async () => broken });
  assert.equal((await job.done).status, "failed");
  assert.equal((await runRow(db, job.runId)).status, "failed");
});

/** A one-page orders response in the Admin API shape. */
const page = (n: number) => ({
  data: {
    orders: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: sample.slice(0, n).map(o => ({
        id: o.id,
        name: o.name,
        createdAt: o.createdAt,
        totalPriceSet: { shopMoney: { amount: String(o.total), currencyCode: o.currency } },
        channelInformation: null,
        customerJourneySummary: null,
        lineItems: { nodes: [] }
      }))
    }
  }
});

test("a throttled page is retried with backoff, then the run finishes", async () => {
  const db = await freshDb();
  let calls = 0;
  const raw: GraphqlRunner = async () => {
    calls++;
    if (calls === 1) return { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] } as never;
    if (calls === 2) throw Object.assign(new Error("Too Many Requests"), { status: 429 });
    return page(25);
  };
  const waits: number[] = [];
  const run = retryingRunner(raw, { baseDelayMs: 100, sleep: async ms => void waits.push(ms) });
  const job = await startReportJob(db, { shop: SHOP, days: 60, fetchOrders: () => fetchOrdersWith(run, 60) });
  const result = await job.done;
  assert.equal(result.status, "done");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [100, 200]);
  assert.equal((await loadLatestView(db, SHOP.domain))!.report.orders, 25);
});

test("throttling that never clears fails the run after the last retry", async () => {
  const db = await freshDb();
  let calls = 0;
  const raw: GraphqlRunner = async () => {
    calls++;
    return { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] } as never;
  };
  const run = retryingRunner(raw, { retries: 3, baseDelayMs: 1, sleep: async () => {} });
  const job = await startReportJob(db, { shop: SHOP, days: 60, fetchOrders: () => fetchOrdersWith(run, 60) });
  const result = await job.done;
  assert.equal(result.status, "failed");
  assert.equal(calls, 4);
  assert.equal((await runRow(db, job.runId)).status, "failed");
});

test("other errors are not retried", async () => {
  let calls = 0;
  const run = retryingRunner(
    async () => {
      calls++;
      throw new Error("Shopify returned HTTP 403.");
    },
    { sleep: async () => {} }
  );
  await assert.rejects(run("query", {}), /403/);
  assert.equal(calls, 1);
  assert.equal(isThrottled({ body: { errors: [{ message: "Field 'x' doesn't exist" }] } }), false);
});

test("two runs started at once for different shops don't corrupt each other", async () => {
  const db = await freshDb();
  const OTHER = { domain: "jobs-other.myshopify.com", name: "Other Store" };
  const a = gate<Order[]>();
  const b = gate<Order[]>();
  const first = await startReportJob(db, { shop: SHOP, days: 90, fetchOrders: () => a.promise, now: () => new Date("2026-10-23T12:00:00Z") });
  const second = await startReportJob(db, { shop: OTHER, days: 90, fetchOrders: () => b.promise, now: () => new Date("2026-10-23T12:00:01Z") });

  // Same order ids in both stores, released in the opposite order, with different totals in the second store.
  b.release(sample.slice(200, 600).map(o => ({ ...o, total: o.total + 1 })));
  a.release(sample.slice(0, 400));
  const [ra, rb] = await Promise.all([first.done, second.done]);
  assert.equal(ra.status, "done");
  assert.equal(rb.status, "done");

  const perRun = async (id: string) => Number((await db.query<{ n: number }>(`select count(*)::int as n from attributions where run_id = $1`, [id]))[0]!.n);
  assert.equal(await perRun(first.runId), 400);
  assert.equal(await perRun(second.runId), 400);
  assert.equal(Number((await db.query<{ n: number }>(`select count(*)::int as n from orders`))[0]!.n), 800);
  assert.ok(ra.status === "done" && rb.status === "done");
  assert.deepEqual(await loadLatestView(db, SHOP.domain), ra.view);
  assert.deepEqual(await loadLatestView(db, OTHER.domain), rb.view);
  assert.equal(rb.view.report.revenue, Math.round(sample.slice(200, 600).reduce((s, o) => s + o.total + 1, 0)));
});

test("a second start for the same shop joins the running report instead of starting another", async () => {
  const db = await freshDb();
  const g = gate<Order[]>();
  const first = await startReportJob(db, { shop: SHOP, days: 60, fetchOrders: () => g.promise });
  await assert.rejects(
    startReportJob(db, { shop: SHOP, days: 60, fetchOrders: async () => sample.slice(0, 10) }),
    (e: unknown) => e instanceof RunInProgressError && e.runId === first.runId
  );
  assert.equal(Number((await db.query<{ n: number }>(`select count(*)::int as n from runs`))[0]!.n), 1);
  g.release(sample.slice(0, 50));
  assert.equal((await first.done).status, "done");
  // Once it's done, a new run can start.
  const next = await startReportJob(db, { shop: SHOP, days: 60, fetchOrders: async () => sample.slice(0, 10) });
  assert.equal((await next.done).status, "done");
});

test("runs with no progress for 10 minutes are failed; a run whose heartbeat is fresh is left alone", async () => {
  const db = await freshDb();
  const t0 = new Date("2026-10-23T12:00:00Z");
  const OTHER = { domain: "jobs-other.myshopify.com" };
  const stale = await startReportJob(db, { shop: SHOP, days: 60, fetchOrders: () => new Promise(() => {}), now: () => t0 });
  const working = await startReportJob(db, { shop: OTHER, days: 60, fetchOrders: () => new Promise(() => {}), now: () => t0 });
  await touchReportRun(db, working.runId, new Date(t0.getTime() + 25 * 60_000));
  const later = new Date(t0.getTime() + 31 * 60_000);

  assert.equal(await failStaleRuns(db, { now: later, shopDomain: OTHER.domain }), 0, "scoped to one shop");
  assert.equal(await failStaleRuns(db, { now: later }), 1);
  assert.equal((await runRow(db, stale.runId)).status, "failed");
  assert.match((await runRow(db, stale.runId)).error!, /restarted/);
  assert.equal((await runRow(db, working.runId)).status, "running");
});

test("a run already failed as stale stays failed when its fetch finally returns", async () => {
  const db = await freshDb();
  const g = gate<Order[]>();
  const t0 = new Date("2026-10-23T12:00:00Z");
  const job = await startReportJob(db, { shop: SHOP, days: 60, fetchOrders: () => g.promise, now: () => t0 });
  await failStaleRuns(db, { now: new Date(t0.getTime() + 60 * 60_000) });
  g.release(sample.slice(0, 20));
  const result = await job.done;
  assert.equal(result.status, "failed");
  const row = await runRow(db, job.runId);
  assert.equal(row.status, "failed");
  assert.match(row.error!, /restarted/);
  assert.equal(Number((await db.query<{ n: number }>(`select count(*)::int as n from attributions where run_id = $1`, [job.runId]))[0]!.n), 0);
});

test("progress from the fetcher keeps the heartbeat fresh", async () => {
  const db = await freshDb();
  const g = gate<Order[]>();
  let progress!: () => void;
  const job = await startReportJob(db, {
    shop: SHOP,
    days: 60,
    fetchOrders: p => {
      progress = p;
      return g.promise;
    }
  });
  const beat = async () => (await db.query<{ h: Date }>(`select heartbeat_at as h from runs where id = $1`, [job.runId]))[0]!.h;
  const before = new Date(await beat()).getTime();
  assert.ok(before > 0);
  progress(); // within 30 s of the start: not written again
  assert.equal(new Date(await beat()).getTime(), before);
  g.release([]);
  assert.equal((await job.done).status, "done");
});
