// Bridge between the Shopify app and @centurion/core. Everything that counts or stores
// data goes through core, so the web app sees exactly what this app writes.
import {
  buildQuestions,
  createAnswerProviders,
  DEMO_NORTHPINE_CATALOG,
  failStaleRuns,
  fetchOrdersWith,
  fetchShopCatalog,
  findings,
  getDb,
  isMetaLive,
  latestReportRun,
  loadLatestAnswerCheck,
  loadLatestCheckoutRun,
  loadLatestView,
  META_DEFAULT_MODEL,
  REPORT_DAYS,
  retryingRunner,
  RunInProgressError,
  runAnswerCheck,
  saveAnswerCheck,
  startReportJob,
  TEST_PAGE_CHECKOUT_RUN,
  type AiSalesView,
  type AnswerCheckRun,
  type AnswerResult,
  type CheckoutRunResult,
  type GraphqlRunner,
  type RunStatus
} from "@centurion/core/server";

type AdminGraphql = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

/**
 * Adapts the Admin API client to a GraphqlRunner. The client throws a Response for HTTP errors (429, 401);
 * that becomes an Error with the status, so retries can see throttling and failed runs record a readable reason.
 */
function runnerWith(client: () => Promise<AdminGraphql>): GraphqlRunner {
  return async (query, variables) => {
    try {
      return await (await (await client())(query, { variables })).json();
    } catch (error) {
      if (error instanceof Response) {
        const hint = error.status === 429 ? " (rate limited)" : error.status === 401 ? " (the store's access token was not accepted)" : "";
        throw Object.assign(new Error(`Shopify returned HTTP ${error.status}${hint}.`), { status: error.status });
      }
      throw error;
    }
  };
}

const runnerFor = (graphql: AdminGraphql) => runnerWith(async () => graphql);

export type ReportState =
  | { configured: false }
  | { configured: true; shop: string; view: AiSalesView | null; run: RunStatus | null; error?: string };

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
    await failStaleRuns(db, { shopDomain: shop });
    const [view, run] = await Promise.all([loadLatestView(db, shop), latestReportRun(db, shop)]);
    return { configured: true, shop, view, run };
  } catch (error) {
    console.error("Loading the latest report failed", error);
    return { configured: true, shop, view: null, run: null, error: dbErrorMessage(error) };
  }
}

/**
 * Starts a report run in the background and returns its id at once, so large stores never hit a request
 * timeout. The screen polls latestReport until the run is done or failed. Throttled pages are retried.
 * `adminGraphql` returns a fresh Admin API client for each page, so a long run survives token refreshes.
 * If a run for this shop is already going, its id is returned instead of starting another.
 */
export async function startReport(input: {
  shop: string;
  scope?: string;
  graphql: AdminGraphql;
  adminGraphql: () => Promise<AdminGraphql>;
}): Promise<{ runId: string; alreadyRunning: boolean }> {
  const db = getDb();
  if (!db) throw new Error("The database is not connected. Set DATABASE_URL and restart the app.");
  await failStaleRuns(db, { shopDomain: input.shop });

  const info = await retryingRunner(runnerFor(input.graphql))(`#graphql
    query CenturionShop { shop { name currencyCode } }`, {});
  const pages = retryingRunner(runnerWith(input.adminGraphql));
  let job: Awaited<ReturnType<typeof startReportJob>>;
  try {
    job = await startReportJob(db, {
      shop: {
        domain: input.shop,
        name: info.data?.shop?.name ?? null,
        currency: info.data?.shop?.currencyCode ?? null,
        scopes: input.scope ? input.scope.split(",") : []
      },
      days: REPORT_DAYS,
      fetchOrders: progress =>
        fetchOrdersWith(async (query, variables) => {
          progress();
          return pages(query, variables);
        }, REPORT_DAYS)
    });
  } catch (error) {
    if (error instanceof RunInProgressError) return { runId: error.runId, alreadyRunning: true };
    throw error;
  }
  void job.done.then(result => {
    if (result.status === "failed") console.error(`Report run ${job.runId} failed: ${result.error}`);
  });
  return { runId: job.runId, alreadyRunning: false };
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

// ---------------------------------------------------------------------------------------------
// Agent Checkout Test
// ---------------------------------------------------------------------------------------------

export type CheckoutTestState = {
  run: CheckoutRunResult;
  /** shop: a run on this store. test_page_db: the latest stored test-page run. test_page_sample: the committed test-page run. */
  source: "shop" | "test_page_db" | "test_page_sample";
};

/** Only the video's file name goes to the browser, never a path on the machine that ran the worker. */
const forBrowser = (run: CheckoutRunResult): CheckoutRunResult => ({ ...run, videoPath: run.videoPath ? (run.videoPath.split(/[\\/]/).pop() ?? null) : null });

/** The shop's latest checkout run, else the latest test-page run, else the committed test-page run. */
export async function checkoutTestState(shop: string): Promise<CheckoutTestState> {
  const db = getDb();
  if (db) {
    try {
      const own = await loadLatestCheckoutRun(db, shop);
      if (own) return { run: forBrowser(own), source: "shop" };
      const testPage = await loadLatestCheckoutRun(db, null);
      if (testPage) return { run: forBrowser(testPage), source: "test_page_db" };
    } catch (error) {
      console.error("Loading checkout runs failed", error);
    }
  }
  return { run: TEST_PAGE_CHECKOUT_RUN, source: "test_page_sample" };
}
