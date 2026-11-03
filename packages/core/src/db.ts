// Postgres store for shops, orders, runs and attributions (schema: supabase/migrations).
// Both apps read and write through these functions only, so they always see the same data.
// Every query is parameterized. Arrays and JSON travel as JSON text parameters cast with
// `$n::text::jsonb`, so the same SQL runs on Supabase (postgres.js, transaction pooler) and in
// tests (PGlite). Never write `$n::jsonb`: postgres.js JSON-encodes the string a second time,
// so the value arrives as a jsonb string scalar ("cannot extract elements from a scalar").
import postgres from "postgres";
import { classifyOrders } from "../../attribution/src/classify.ts";
import type { Attribution, Order, SignatureFile } from "../../attribution/src/types.ts";
import { currentSignatures } from "./signatures.ts";
import type { AnswerCheckRun } from "./answer-check/types.ts";
import type { CheckoutRunResult } from "./checkout-types.ts";
import type { AppliedFix, FixBaseline, FixSuggestion } from "./weekly-fix.ts";
import type { AiSalesView } from "./types.ts";
import { assembleView, canonicalOrders } from "./view.ts";

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

/** Wraps postgres.js. `prepare: false` keeps it compatible with Supabase's transaction pooler. */
export function postgresDb(url: string): Db {
  const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 15 });
  const wrap = (s: postgres.Sql | postgres.TransactionSql): Queryable => ({
    query: async <T>(text: string, params: unknown[] = []) => (await s.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[]
  });
  return {
    ...wrap(sql),
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) => sql.begin(tx => fn(wrap(tx))) as Promise<T>
  };
}

const globalForDb = globalThis as unknown as { centurionDb?: Db };

/**
 * The shared database, from DATABASE_URL. Returns null when it isn't configured, so callers
 * can show demo data or a setup message. In local dev, DATABASE_URL may live in the repo root .env.
 */
export function getDb(): Db | null {
  if (!process.env.DATABASE_URL) {
    for (const path of [".env", "../.env", "../../.env"]) {
      try {
        process.loadEnvFile(path);
      } catch {
        /* no file there */
      }
      if (process.env.DATABASE_URL) break;
    }
  }
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  globalForDb.centurionDb ??= postgresDb(url);
  return globalForDb.centurionDb;
}

const CHUNK = 500;
const chunks = <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));
const json = (v: unknown) => JSON.stringify(v);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export interface ShopInfo {
  domain: string;
  name?: string | null;
  currency?: string | null;
  scopes?: string[];
}

async function upsertShop(q: Queryable, shop: ShopInfo): Promise<string> {
  const [row] = await q.query<{ id: string }>(
    `insert into shops (shop_domain, name, currency, scopes)
     values ($1, $2, $3, array(select jsonb_array_elements_text($4::text::jsonb)))
     on conflict (shop_domain) do update set
       name = coalesce(excluded.name, shops.name),
       currency = coalesce(excluded.currency, shops.currency),
       scopes = case when cardinality(excluded.scopes) > 0 then excluded.scopes else shops.scopes end,
       uninstalled_at = null
     returning id`,
    [shop.domain, shop.name ?? null, shop.currency ?? null, json(shop.scopes ?? [])]
  );
  return row!.id;
}

/** A report for this shop is already running. `runId` is that run. */
export class RunInProgressError extends Error {
  constructor(readonly runId: string) {
    super("A report is already running for this store.");
    this.name = "RunInProgressError";
  }
}

/**
 * Creates a report run in status 'running' and returns its id. The orders are stored later by completeReportRun.
 * Throws RunInProgressError when the shop already has a running report (one at a time per shop).
 */
export async function createReportRun(
  db: Queryable,
  input: { shop: ShopInfo; days: number; file?: SignatureFile; now?: Date }
): Promise<{ runId: string; shopId: string }> {
  const file = input.file ?? currentSignatures;
  const now = input.now ?? new Date();
  const shopId = await upsertShop(db, input.shop);
  await db.query(
    `insert into signature_versions (version, file, created_by) values ($1, $2::text::jsonb, 'engine') on conflict (version) do nothing`,
    [file.version, json(file)]
  );
  // "on conflict do nothing" against the one-running-report-per-shop index, so a second press never errors mid-transaction.
  const [run] = await db.query<{ id: string }>(
    `insert into runs (shop_id, kind, signature_version, period_start, period_end, started_at, heartbeat_at)
     values ($1, 'report', $2, $3::date, $4::date, $5, $5)
     on conflict (shop_id) where kind = 'report' and status = 'running' do nothing
     returning id`,
    [shopId, file.version, isoDate(new Date(now.getTime() - input.days * 864e5)), isoDate(now), now.toISOString()]
  );
  if (!run) {
    const [current] = await db.query<{ id: string }>(`select id from runs where shop_id = $1 and kind = 'report' and status = 'running'`, [shopId]);
    throw new RunInProgressError(current?.id ?? "");
  }
  return { runId: run.id, shopId };
}

/**
 * Classifies the orders and stores them with their attributions under an existing run, then marks it
 * 'done', all in one transaction. Returns the view. Throws (leaving the run untouched) if storing fails.
 */
export async function completeReportRun(
  db: Db,
  input: { runId: string; shopId: string; shop: ShopInfo; orders: Order[]; file?: SignatureFile; now?: Date }
): Promise<AiSalesView> {
  const file = input.file ?? currentSignatures;
  const now = input.now ?? new Date();
  const orders = canonicalOrders(input.orders);
  const { runId, shopId } = input;
  return db.transaction(async tx => {
    for (const part of chunks(orders)) {
      await tx.query(
        `insert into orders (shop_id, id, name, created_at, total, currency, channel, first_visit, last_visit, line_items, fetched_at)
         select $1::uuid, r.id, r.name, r.created_at, r.total, r.currency, r.channel, r.first_visit, r.last_visit, r.line_items, now()
         from jsonb_to_recordset($2::text::jsonb) as r(id text, name text, created_at timestamptz, total numeric, currency text,
           channel text, first_visit jsonb, last_visit jsonb, line_items jsonb)
         on conflict (shop_id, id) do update set
           name = excluded.name, created_at = excluded.created_at, total = excluded.total, currency = excluded.currency,
           channel = excluded.channel, first_visit = excluded.first_visit, last_visit = excluded.last_visit,
           line_items = excluded.line_items, fetched_at = excluded.fetched_at`,
        [
          shopId,
          json(
            part.map(o => ({
              id: o.id,
              name: o.name,
              created_at: o.createdAt,
              total: o.total,
              currency: o.currency,
              channel: o.channel ?? null,
              first_visit: o.firstVisit ?? null,
              last_visit: o.lastVisit ?? null,
              line_items: o.lineItems
            }))
          )
        ]
      );
    }

    // Store exactly the attributions the view counts.
    const attributions = classifyOrders(orders, file.signatures);
    const built = assembleView({
      orders,
      attributions,
      file,
      store: { name: input.shop.name ?? input.shop.domain, domain: input.shop.domain },
      generatedAt: now.toISOString()
    });
    for (const part of chunks(attributions)) {
      await tx.query(
        `insert into attributions (run_id, shop_id, order_id, is_ai, source, touch, evidence, proof)
         select $1::uuid, $2::uuid, r.order_id, r.is_ai, r.source, r.touch, r.evidence,
           array(select jsonb_array_elements_text(r.proof))
         from jsonb_to_recordset($3::text::jsonb) as r(order_id text, is_ai boolean, source text, touch text, evidence text, proof jsonb)`,
        [
          runId,
          shopId,
          json(part.map(a => ({ order_id: a.orderId, is_ai: a.isAI, source: a.source, touch: a.touch, evidence: a.evidence, proof: a.proof })))
        ]
      );
    }
    // Only a run that is still 'running' can finish; one already failed (for example as stale) stays failed.
    const updated = await tx.query(`update runs set status = 'done', summary = $2::text::jsonb, finished_at = $3 where id = $1 and status = 'running' returning id`, [
      runId,
      json(built.report),
      now.toISOString()
    ]);
    if (updated.length === 0) throw new Error("This report run was already marked failed, so its results were not saved.");
    return built;
  });
}

/** Marks a run 'failed' with the error (trimmed to 1,000 characters). */
export async function failReportRun(db: Queryable, runId: string, error: string): Promise<void> {
  await db.query(`update runs set status = 'failed', error = $2, finished_at = now() where id = $1 and status = 'running'`, [runId, error.slice(0, 1000)]);
}

/**
 * Classifies the orders, stores them with their attributions as one report run, and returns
 * the view. If storing fails, the run is kept with status 'failed' and the error.
 */
export async function saveReportRun(
  db: Db,
  input: { shop: ShopInfo; orders: Order[]; days: number; file?: SignatureFile; now?: Date }
): Promise<{ runId: string; view: AiSalesView }> {
  const { runId, shopId } = await createReportRun(db, input);
  try {
    const view = await completeReportRun(db, { runId, shopId, shop: input.shop, orders: input.orders, file: input.file, now: input.now });
    return { runId, view };
  } catch (error) {
    await failReportRun(db, runId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export interface RunStatus {
  id: string;
  status: "running" | "done" | "failed";
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** The shop's most recently started report run, whatever its status. Null if it has none. */
export async function latestReportRun(db: Queryable, shopDomain: string): Promise<RunStatus | null> {
  const [row] = await db.query<{ id: string; status: RunStatus["status"]; error: string | null; started_at: Date | string; finished_at: Date | string | null }>(
    `select r.id, r.status, r.error, r.started_at, r.finished_at
     from runs r join shops s on s.id = r.shop_id
     where s.shop_domain = $1 and r.kind = 'report'
     order by r.started_at desc, r.id desc limit 1`,
    [shopDomain]
  );
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null
  };
}

/** Records that a running report is still making progress. */
export async function touchReportRun(db: Queryable, runId: string, now: Date = new Date()): Promise<void> {
  await db.query(`update runs set heartbeat_at = $2 where id = $1 and status = 'running'`, [runId, now.toISOString()]);
}

/**
 * Fails report runs with no progress for `olderThanMinutes`: their process stopped (deploy, crash) before
 * finishing. Running jobs touch their heartbeat as pages arrive, so a long run is never failed while it works.
 * Pass `shopDomain` to check one shop.
 */
export async function failStaleRuns(db: Queryable, opts: { olderThanMinutes?: number; now?: Date; shopDomain?: string } = {}): Promise<number> {
  const rows = await db.query(
    `update runs set status = 'failed', error = 'The report stopped before finishing (the app restarted). Run it again.', finished_at = $2
     where status = 'running' and kind = 'report'
       and coalesce(heartbeat_at, started_at) < $2::timestamptz - make_interval(mins => $1::int)
       and ($3::text is null or shop_id = (select id from shops where shop_domain = $3))
     returning id`,
    [opts.olderThanMinutes ?? 10, (opts.now ?? new Date()).toISOString(), opts.shopDomain ?? null]
  );
  return rows.length;
}

interface RunRow {
  id: string;
  finished_at: Date | string;
  shop_domain: string;
  name: string | null;
  file: SignatureFile | null;
}

interface AttributionRow {
  id: string;
  name: string;
  created_at: Date | string;
  total: string | number;
  currency: string;
  channel: string | null;
  first_visit: Order["firstVisit"];
  last_visit: Order["lastVisit"];
  line_items: Order["lineItems"];
  is_ai: boolean;
  source: string | null;
  touch: Attribution["touch"];
  evidence: Attribution["evidence"];
  proof: string[];
}

/** The latest finished report for a shop, rebuilt from stored rows. Null if the shop has no report yet. */
export async function loadLatestView(db: Queryable, shopDomain: string): Promise<AiSalesView | null> {
  const [run] = await db.query<RunRow>(
    `select r.id, r.finished_at, s.shop_domain, s.name, sv.file
     from runs r
     join shops s on s.id = r.shop_id
     left join signature_versions sv on sv.version = r.signature_version
     where s.shop_domain = $1 and r.kind = 'report' and r.status = 'done' and s.uninstalled_at is null
     order by r.finished_at desc
     limit 1`,
    [shopDomain]
  );
  if (!run) return null;

  const rows = await db.query<AttributionRow>(
    `select o.id, o.name, o.created_at, o.total, o.currency, o.channel, o.first_visit, o.last_visit, o.line_items,
            a.is_ai, a.source, a.touch, a.evidence, a.proof
     from attributions a
     join orders o on o.shop_id = a.shop_id and o.id = a.order_id
     where a.run_id = $1`,
    [run.id]
  );

  const orders = canonicalOrders(
    rows.map(r => ({
      id: r.id,
      name: r.name,
      createdAt: new Date(r.created_at).toISOString(),
      total: Number(r.total),
      currency: r.currency,
      channel: r.channel,
      firstVisit: r.first_visit,
      lastVisit: r.last_visit,
      lineItems: r.line_items
    }))
  );
  const byId = new Map(orders.map(o => [o.id, o]));
  const attributions: Attribution[] = rows.map(r => {
    const o = byId.get(r.id)!;
    return {
      orderId: o.id,
      orderName: o.name,
      createdAt: o.createdAt,
      total: o.total,
      isAI: r.is_ai,
      source: r.source,
      touch: r.touch,
      evidence: r.evidence,
      proof: r.proof
    };
  });

  return assembleView({
    orders,
    attributions,
    file: run.file ?? currentSignatures,
    store: { name: run.name ?? run.shop_domain, domain: run.shop_domain },
    generatedAt: new Date(run.finished_at).toISOString()
  });
}

/** app/uninstalled: keep data (the merchant may reinstall) but stop showing it. */
export async function markShopUninstalled(db: Queryable, shopDomain: string): Promise<void> {
  await db.query(`update shops set uninstalled_at = now() where shop_domain = $1`, [shopDomain]);
}

/** shop/redact (48h after uninstall): delete everything stored for the shop. */
export async function deleteShopData(db: Queryable, shopDomain: string): Promise<void> {
  await db.query(`delete from shops where shop_domain = $1`, [shopDomain]);
}

/** customers/redact: delete the listed orders (numeric Shopify ids) and their attributions. */
export async function redactOrders(db: Queryable, shopDomain: string, orderIds: (number | string)[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  const gids = orderIds.map(id => (String(id).startsWith("gid://") ? String(id) : `gid://shopify/Order/${id}`));
  const rows = await db.query(
    `delete from orders where shop_id = (select id from shops where shop_domain = $1)
       and id in (select jsonb_array_elements_text($2::text::jsonb)) returning id`,
    [shopDomain, json(gids)]
  );
  return rows.length;
}

/** Stores an Answer Check run for the shop. Returns the new row id. */
export async function saveAnswerCheck(db: Queryable, shop: ShopInfo, run: AnswerCheckRun): Promise<string> {
  const shopId = await upsertShop(db, shop);
  const [row] = await db.query<{ id: string }>(
    `insert into answer_checks (shop_id, mode, asked, contradictions, result, created_at)
     values ($1, $2, $3, $4, $5::text::jsonb, $6) returning id`,
    [shopId, run.mode, run.asked, run.contradictions, json(run), run.generatedAt]
  );
  return row!.id;
}

/** The shop's latest stored Answer Check, or null. */
export async function loadLatestAnswerCheck(db: Queryable, shopDomain: string): Promise<AnswerCheckRun | null> {
  const [row] = await db.query<{ result: AnswerCheckRun | string }>(
    `select a.result from answer_checks a join shops s on s.id = a.shop_id
     where s.shop_domain = $1 and s.uninstalled_at is null
     order by a.created_at desc limit 1`,
    [shopDomain]
  );
  if (!row) return null;
  return typeof row.result === "string" ? (JSON.parse(row.result) as AnswerCheckRun) : row.result;
}

/** Stores a checkout test run in the failure corpus. `shop` is null for runs on the local test page. */
export async function saveCheckoutRun(db: Queryable, input: { shop: ShopInfo | null; run: CheckoutRunResult }): Promise<string> {
  const { run } = input;
  // Look the shop up (or add it) without touching its install state: a test run never re-installs a shop.
  let shopId: string | null = null;
  if (input.shop) {
    const [row] = await db.query<{ id: string }>(
      `insert into shops (shop_domain, name) values ($1, $2) on conflict (shop_domain) do update set shop_domain = excluded.shop_domain returning id`,
      [input.shop.domain, input.shop.name ?? null]
    );
    shopId = row!.id;
  }
  const failed = run.failedStep ? run.steps.find(s => s.n === run.failedStep) : undefined;
  const [row] = await db.query<{ id: string }>(
    `insert into checkout_runs (shop_id, target_url, target_kind, agent, result, failed_step, failure_kind, problems, steps, video_path, result_json, started_at, finished_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb, $10, $11::text::jsonb, $12, $13) returning id`,
    [
      shopId,
      run.target.url,
      run.target.kind,
      run.agent,
      run.result,
      run.failedStep,
      failed?.title ?? null,
      run.problems,
      json(run.steps),
      run.videoPath,
      json(run),
      run.startedAt,
      run.finishedAt
    ]
  );
  return row!.id;
}

/** The latest checkout test run for a shop, or for the local test page when `shopDomain` is null. */
export async function loadLatestCheckoutRun(db: Queryable, shopDomain: string | null): Promise<CheckoutRunResult | null> {
  const [row] = await db.query<{ result_json: CheckoutRunResult | string }>(
    shopDomain
      ? `select c.result_json from checkout_runs c join shops s on s.id = c.shop_id
         where s.shop_domain = $1 and s.uninstalled_at is null order by c.started_at desc limit 1`
      : `select result_json from checkout_runs where shop_id is null and target_kind = 'test_page' and $1::text is null order by started_at desc limit 1`,
    [shopDomain]
  );
  if (!row) return null;
  return typeof row.result_json === "string" ? (JSON.parse(row.result_json) as CheckoutRunResult) : row.result_json;
}

/** Failure corpus summary: how often each step blocked agents, across all runs. No store names. */
export async function checkoutFailureCounts(db: Queryable): Promise<{ failureKind: string; runs: number }[]> {
  const rows = await db.query<{ failure_kind: string; runs: number }>(
    `select failure_kind, count(*)::int as runs from checkout_runs where result = 'blocked' and failure_kind is not null
     group by failure_kind order by runs desc, failure_kind`
  );
  return rows.map(r => ({ failureKind: r.failure_kind, runs: Number(r.runs) }));
}

export interface StoredFix extends AppliedFix {
  id: string;
  status: "applied" | "undone";
  undoneAt: string | null;
}

/** Records an applied fix. */
export async function saveAppliedFix(db: Queryable, shop: ShopInfo, fix: AppliedFix): Promise<string> {
  const shopId = await upsertShop(db, shop);
  const [row] = await db.query<{ id: string }>(
    `insert into weekly_fixes (shop_id, fix_key, product_id, product_title, status, suggestion, before_html, after_html, baseline, applied_at)
     values ($1, $2, $3, $4, 'applied', $5::text::jsonb, $6, $7, $8::text::jsonb, $9) returning id`,
    [shopId, fix.suggestion.key, fix.suggestion.productId, fix.suggestion.productTitle, json(fix.suggestion), fix.beforeHtml, fix.afterHtml, json(fix.baseline), fix.appliedAt]
  );
  return row!.id;
}

/** Marks an applied fix as undone. Returns false if it wasn't applied (already undone or unknown). */
export async function markFixUndone(db: Queryable, fixId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await db.query(`update weekly_fixes set status = 'undone', undone_at = $2 where id = $1 and status = 'applied' returning id`, [fixId, now.toISOString()]);
  return rows.length > 0;
}

/** The shop's most recent fix, applied or undone. */
export async function latestFix(db: Queryable, shopDomain: string): Promise<StoredFix | null> {
  const [row] = await db.query<{
    id: string;
    status: StoredFix["status"];
    suggestion: FixSuggestion | string;
    before_html: string;
    after_html: string;
    baseline: FixBaseline | string;
    applied_at: Date | string;
    undone_at: Date | string | null;
  }>(
    `select f.id, f.status, f.suggestion, f.before_html, f.after_html, f.baseline, f.applied_at, f.undone_at
     from weekly_fixes f join shops s on s.id = f.shop_id
     where s.shop_domain = $1 and s.uninstalled_at is null order by f.applied_at desc limit 1`,
    [shopDomain]
  );
  if (!row) return null;
  const parse = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
  return {
    id: row.id,
    status: row.status,
    suggestion: parse(row.suggestion),
    beforeHtml: row.before_html,
    afterHtml: row.after_html,
    baseline: parse(row.baseline),
    appliedAt: new Date(row.applied_at).toISOString(),
    undoneAt: row.undone_at ? new Date(row.undone_at).toISOString() : null
  };
}
