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

/**
 * Classifies the orders, stores them with their attributions as one report run, and returns
 * the view. If storing fails, the run is kept with status 'failed' and the error.
 */
export async function saveReportRun(
  db: Db,
  input: { shop: ShopInfo; orders: Order[]; days: number; file?: SignatureFile; now?: Date }
): Promise<{ runId: string; view: AiSalesView }> {
  const file = input.file ?? currentSignatures;
  const now = input.now ?? new Date();
  const orders = canonicalOrders(input.orders);

  const shopId = await upsertShop(db, input.shop);
  await db.query(
    `insert into signature_versions (version, file, created_by) values ($1, $2::text::jsonb, 'engine') on conflict (version) do nothing`,
    [file.version, json(file)]
  );
  const [run] = await db.query<{ id: string }>(
    `insert into runs (shop_id, kind, signature_version, period_start, period_end)
     values ($1, 'report', $2, $3::date, $4::date) returning id`,
    [shopId, file.version, isoDate(new Date(now.getTime() - input.days * 864e5)), isoDate(now)]
  );
  const runId = run!.id;

  try {
    const view = await db.transaction(async tx => {
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
      await tx.query(`update runs set status = 'done', summary = $2::text::jsonb, finished_at = $3 where id = $1`, [
        runId,
        json(built.report),
        now.toISOString()
      ]);
      return built;
    });
    return { runId, view };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.query(`update runs set status = 'failed', error = $2, finished_at = now() where id = $1`, [runId, message.slice(0, 1000)]);
    throw error;
  }
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
