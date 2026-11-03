// Bridge between the Shopify app and @centurion/core. Everything that counts or stores
// data goes through core, so the web app sees exactly what this app writes.
import {
  buildQuestions,
  createAnswerProviders,
  DEMO_NORTHPINE_CATALOG,
  fetchOrdersWith,
  fetchShopCatalog,
  findings,
  getDb,
  isMetaLive,
  loadLatestAnswerCheck,
  loadLatestView,
  META_DEFAULT_MODEL,
  REPORT_DAYS,
  runAnswerCheck,
  saveAnswerCheck,
  saveReportRun,
  type AiSalesView,
  type AnswerCheckRun,
  type AnswerResult,
  type GraphqlRunner
} from "@centurion/core/server";

type AdminGraphql = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

function runnerFor(graphql: AdminGraphql): GraphqlRunner {
  return async (query, variables) => (await graphql(query, { variables })).json();
}

export type ReportState =
  | { configured: false }
  | { configured: true; shop: string; view: AiSalesView | null; error?: string };

/** Plain-words reason for a database failure. Never includes the connection string. */
function dbErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/password authentication failed/i.test(message)) {
    return "The database rejected the password in DATABASE_URL. Check it is the real database password (not [YOUR-PASSWORD]), URL-encoded if it has symbols like @ : / # %.";
  }
  if (/tenant or user not found/i.test(message)) return "The database user in DATABASE_URL is wrong. For the pooler it looks like postgres.<project-ref>.";
  if (/relation .* does not exist/i.test(message)) {
    const table = message.match(/relation "?([\w.]+)"? does not exist/i)?.[1];
    return `The database is reachable but ${table ? `the ${table} table is` : "tables are"} missing. Apply every file in supabase/migrations/ in filename order (Supabase SQL editor).`;
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) return "Could not reach the database host in DATABASE_URL.";
  return `Database error: ${message}`;
}

/** For the Run report action: database problems in plain words, other errors as they are. */
export function runErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /password|tenant|relation .* does not exist|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message) ? dbErrorMessage(error) : message;
}

export async function latestReport(shop: string): Promise<ReportState> {
  const db = getDb();
  if (!db) return { configured: false };
  try {
    return { configured: true, shop, view: await loadLatestView(db, shop) };
  } catch (error) {
    console.error("Loading the latest report failed", error);
    return { configured: true, shop, view: null, error: dbErrorMessage(error) };
  }
}

/** Fetches recent orders with the app's authenticated client, classifies them and stores the run. */
export async function runReport(input: { shop: string; scope?: string; graphql: AdminGraphql }) {
  const db = getDb();
  if (!db) throw new Error("The database is not connected. Set DATABASE_URL and restart the app.");
  const run = runnerFor(input.graphql);

  const info = await run(`#graphql
    query CenturionShop { shop { name currencyCode } }`, {});
  const orders = await fetchOrdersWith(run, REPORT_DAYS);
  const { view } = await saveReportRun(db, {
    shop: {
      domain: input.shop,
      name: info.data?.shop?.name ?? null,
      currency: info.data?.shop?.currencyCode ?? null,
      scopes: input.scope ? input.scope.split(",") : []
    },
    orders,
    days: REPORT_DAYS
  });
  return { orders: orders.length, aiOrders: view.report.ai.orders };
}

// ---------------------------------------------------------------------------------------------
// AI Answer Check
// ---------------------------------------------------------------------------------------------

export type AnswerCheckState = {
  /** True when META_API_KEY is set, so runs ask Meta Llama about this store's own catalog. */
  live: boolean;
  model: string;
  run: AnswerCheckRun | null;
  findings: AnswerResult[];
  error?: string;
};

const withFindings = (run: AnswerCheckRun | null) => ({ run, findings: run ? findings(run) : [] });

/**
 * Live (META_API_KEY set): the shop's latest stored run. Without a key: the labeled fixture run on the
 * fictional Northpine catalog, rebuilt on every load and never stored.
 */
export async function answerCheckState(shop: string): Promise<AnswerCheckState> {
  const model = process.env.META_MODEL || META_DEFAULT_MODEL;
  if (!isMetaLive(process.env)) {
    const run = await runAnswerCheck({ catalog: DEMO_NORTHPINE_CATALOG, providers: createAnswerProviders({}) });
    return { live: false, model, ...withFindings(run) };
  }
  const db = getDb();
  if (!db) return { live: true, model, ...withFindings(null) };
  try {
    return { live: true, model, ...withFindings(await loadLatestAnswerCheck(db, shop)) };
  } catch (error) {
    console.error("Loading the latest answer check failed", error);
    return { live: true, model, ...withFindings(null), error: dbErrorMessage(error) };
  }
}

/** Asks Meta Llama about the store's products (AI best sellers first), compares with the catalog and stores the run. */
export async function runLiveAnswerCheck(input: { shop: string; graphql: AdminGraphql }) {
  if (!isMetaLive(process.env)) throw new Error("Set META_API_KEY to ask Meta Llama about your store.");
  const db = getDb();
  const report = db ? await loadLatestView(db, input.shop).catch(() => null) : null;
  const catalog = await fetchShopCatalog(runnerFor(input.graphql), { bestSellers: report?.report.top_products.map(p => p.title) });
  if (catalog.products.length === 0) throw new Error("The store has no active products to ask about.");
  const run = await runAnswerCheck({ catalog, providers: createAnswerProviders(process.env), questions: buildQuestions(catalog, { maxProducts: 5, maxPerProduct: 3 }) });
  if (db) await saveAnswerCheck(db, { domain: input.shop, name: catalog.store.name }, run);
  return { asked: run.asked, contradictions: run.contradictions, errors: run.errors, ...withFindings(run) };
}
