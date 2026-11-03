// Bridge between the Shopify app and @centurion/core. Everything that counts or stores
// data goes through core, so the web app sees exactly what this app writes.
import {
  fetchOrdersWith,
  getDb,
  loadLatestView,
  REPORT_DAYS,
  saveReportRun,
  type AiSalesView,
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
  if (/relation .* does not exist/i.test(message)) return "The database is reachable but the tables are missing. Run supabase/migrations/20261026000000_init.sql in the Supabase SQL editor.";
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
