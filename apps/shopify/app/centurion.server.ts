// Bridge between the Shopify app and @centurion/core. Everything that counts or stores
// data goes through core, so the web app sees exactly what this app writes.
import {
  askAssistant,
  askAssistantRich,
  applyFixLive,
  undoFixLive,
  storeWritesEnabled as writesOn,
  type AssistantReply,
  ASSISTANT_SUGGESTIONS,
  type AssistantTurn,
  applyFix,
  buildQuestions,
  createAnswerProviders,
  DEMO_NORTHPINE_CATALOG,
  DEMO_SALES_SNAPSHOT,
  explainFix,
  failStaleRuns,
  fetchOrdersWith,
  fetchShopCatalog,
  findings,
  getDb,
  isMetaLive,
  aiRevenueSince,
  completeFix,
  latestFix,
  latestReportRun,
  loadLatestAnswerCheck,
  loadLatestCheckoutRun,
  loadLatestView,
  markFixUndone,
  measureFix,
  META_DEFAULT_MODEL,
  REPORT_DAYS,
  retryingRunner,
  RunInProgressError,
  runAnswerCheck,
  saveAnswerCheck,
  releaseFix,
  reserveFix,
  shopifyProductAdmin,
  StoreWritesOffError,
  startReportJob,
  storeWritesEnabled,
  suggestFix,
  TEST_PAGE_CHECKOUT_RUN,
  undoFix,
  type AiSalesView,
  type AnswerCheckRun,
  type AnswerResult,
  type CheckoutRunResult,
  type FixMeasurement,
  type FixSuggestion,
  type GraphqlRunner,
  type RunStatus,
  type StoredFix
} from "@centurion/core/server";

// DEMO AI Sales report for Northpine Outfitters, a fictional store: the engine's output on sample orders
// (apps/web/data/demo.json, kept in sync by packages/core/test/sync.test.ts). Shown, labeled, when a store
// has no AI orders of its own yet, so a new merchant sees what the report looks like.
import DEMO_AI_SALES_JSON from "../../web/data/demo.json";
export const DEMO_AI_SALES_VIEW = DEMO_AI_SALES_JSON as unknown as AiSalesView;

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

export type ReportState = (
  | { configured: false }
  | { configured: true; shop: string; view: AiSalesView | null; run: RunStatus | null; error?: string }
) & {
  /** The labeled DEMO report, set only when this store has no AI orders to show yet. */
  demo: AiSalesView | null;
};

const demoUnless = (view: AiSalesView | null | undefined) => (view && view.report.ai.orders > 0 ? null : DEMO_AI_SALES_VIEW);

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
  if (!db) return { configured: false, demo: DEMO_AI_SALES_VIEW };
  try {
    await failStaleRuns(db, { shopDomain: shop });
    const [view, run] = await Promise.all([loadLatestView(db, shop), latestReportRun(db, shop)]);
    return { configured: true, shop, view, run, demo: demoUnless(view) };
  } catch (error) {
    console.error("Loading the latest report failed", error);
    return { configured: true, shop, view: null, run: null, error: dbErrorMessage(error), demo: DEMO_AI_SALES_VIEW };
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
  /** True when META_API_KEY is set, so runs ask Meta Muse Spark about this store's own catalog. */
  live: boolean;
  model: string;
  run: AnswerCheckRun | null;
  findings: AnswerResult[];
  error?: string;
  /**
   * Live mode only: the labeled fixture run on the fictional Northpine catalog, set when this store's latest
   * run found no contradictions (or there is none yet), so the screen can show what a wrong answer looks like.
   */
  demo: { run: AnswerCheckRun; findings: AnswerResult[] } | null;
};

const withFindings = (run: AnswerCheckRun | null) => ({ run, findings: run ? findings(run) : [] });

/**
 * Live (META_API_KEY set): the shop's latest stored run. Without a key: the labeled fixture run on the
 * fictional Northpine catalog, rebuilt on every load and never stored.
 */
export async function demoAnswerCheck(): Promise<{ run: AnswerCheckRun; findings: AnswerResult[] }> {
  const run = await runAnswerCheck({ catalog: DEMO_NORTHPINE_CATALOG, providers: createAnswerProviders({}) });
  return { run, findings: findings(run) };
}

export async function answerCheckState(shop: string): Promise<AnswerCheckState> {
  const model = process.env.META_MODEL || META_DEFAULT_MODEL;
  if (!isMetaLive(process.env)) return { live: false, model, ...(await demoAnswerCheck()), demo: null };
  const demoUnlessFound = async (run: AnswerCheckRun | null) => (run && run.contradictions > 0 ? null : await demoAnswerCheck());
  const db = getDb();
  if (!db) return { live: true, model, ...withFindings(null), demo: await demoUnlessFound(null) };
  try {
    const run = await loadLatestAnswerCheck(db, shop);
    return { live: true, model, ...withFindings(run), demo: await demoUnlessFound(run) };
  } catch (error) {
    console.error("Loading the latest answer check failed", error);
    return { live: true, model, ...withFindings(null), error: dbErrorMessage(error), demo: await demoUnlessFound(null) };
  }
}

/** Asks Meta Muse Spark about the store's products (AI best sellers first), compares with the catalog and stores the run. */
export async function runLiveAnswerCheck(input: { shop: string; graphql: AdminGraphql }) {
  if (!isMetaLive(process.env)) throw new Error("Set META_API_KEY to ask Meta Muse Spark about your store.");
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

// ---------------------------------------------------------------------------------------------
// Weekly Fix
// ---------------------------------------------------------------------------------------------

export type WeeklyFixState = {
  /** Apply and undo change the live store only when CENTURION_STORE_WRITES=on. */
  writesEnabled: boolean;
  /** This store's fix, chosen from its own stored AI Sales report and live Answer Check. */
  suggestion: FixSuggestion | null;
  /** Why there is no fix for this store this week. */
  reason?: string;
  /** The same rule on the fictional Northpine demo data, shown when this store has no fix. */
  demo: { suggestion: FixSuggestion; before: string } | null;
  current: StoredFix | null;
  measurement: FixMeasurement | null;
  error?: string;
};

// Meta's wording of an explanation, per suggestion and template text, so page loads don't call Meta each time.
const explained = new Map<string, FixSuggestion>();
async function explainOnce(s: FixSuggestion): Promise<FixSuggestion> {
  const key = `${s.key}|${s.explanation}`;
  const cached = explained.get(key);
  if (cached) return cached;
  const result = await explainFix(s);
  if (explained.size > 500) explained.clear();
  explained.set(key, result);
  return result;
}

/** The store's own fix: needs a stored AI Sales report, a stored live Answer Check and the product catalog. */
async function liveSuggestion(shop: string, graphql: AdminGraphql, opts: { explain: boolean }): Promise<{ suggestion: FixSuggestion | null; reason?: string }> {
  const db = getDb();
  if (!db) return { suggestion: null, reason: "The database is not connected." };
  const view = await loadLatestView(db, shop);
  if (!view) return { suggestion: null, reason: "Run an AI Sales report first: the fix is chosen from the products AI sells." };
  const answerCheck = isMetaLive(process.env) ? await loadLatestAnswerCheck(db, shop) : null;
  if (!answerCheck) return { suggestion: null, reason: "Run a live Answer Check first (it needs META_API_KEY): the fix targets what AI gets wrong." };
  const catalog = await fetchShopCatalog(runnerFor(graphql), { bestSellers: view.report.top_products.map(p => p.title) });
  const suggestion = suggestFix({ sales: view.report, answerCheck, catalog });
  if (!suggestion) return { suggestion: null, reason: "AI got no catalog facts wrong about the products it sells. Nothing to fix this week." };
  return { suggestion: opts.explain ? await explainOnce(suggestion) : suggestion };
}

async function demoSuggestion(): Promise<WeeklyFixState["demo"]> {
  const answerCheck = await runAnswerCheck({ catalog: DEMO_NORTHPINE_CATALOG, providers: createAnswerProviders({}) });
  const suggestion = suggestFix({ sales: DEMO_SALES_SNAPSHOT, answerCheck, catalog: DEMO_NORTHPINE_CATALOG });
  if (!suggestion) return null;
  const before = DEMO_NORTHPINE_CATALOG.products.find(p => p.id === suggestion.productId)?.description ?? "";
  return { suggestion, before };
}

export async function weeklyFixState(shop: string, graphql: AdminGraphql): Promise<WeeklyFixState> {
  const writesEnabled = storeWritesEnabled(process.env);
  const db = getDb();
  let live: { suggestion: FixSuggestion | null; reason?: string };
  let error: string | undefined;
  try {
    live = await liveSuggestion(shop, graphql, { explain: true });
  } catch (e) {
    console.error("Choosing this week's fix failed", e);
    live = { suggestion: null, reason: "This week's fix couldn't be chosen." };
    error = runErrorMessage(e);
  }
  const current = db ? await latestFix(db, shop).catch(() => null) : null;
  // Measure from AI orders placed after the fix went live, in the latest report.
  const since = db && current?.status === "applied" ? await aiRevenueSince(db, shop, current.appliedAt).catch(() => null) : null;
  const measurement = current && since && Object.keys(since.revenue).length > 0 ? measureFix(current.baseline, since) : null;
  return {
    writesEnabled,
    suggestion: live.suggestion,
    reason: live.reason,
    demo: live.suggestion ? null : await demoSuggestion(),
    current,
    measurement,
    error
  };
}

/**
 * Applies this week's fix to the store. The suggestion is chosen again here (nothing from the browser is
 * trusted) and must be the one the merchant saw (`key`). The store's fix slot is reserved first, so a store
 * change is always recorded: if recording fails, the store change is reverted.
 */
export async function applyWeeklyFix(shop: string, graphql: AdminGraphql, key: string) {
  const db = getDb();
  if (!db) throw new Error("The database is not connected. Set DATABASE_URL and restart the app.");
  if (!storeWritesEnabled(process.env)) throw new StoreWritesOffError();
  const { suggestion, reason } = await liveSuggestion(shop, graphql, { explain: false });
  if (!suggestion) throw new Error(reason ?? "There is no fix to apply this week.");
  if (suggestion.key !== key) throw new Error("This week's fix changed since the page loaded. Reload to see it before applying.");

  const admin = shopifyProductAdmin(runnerFor(graphql));
  const id = await reserveFix(db, { domain: shop }, suggestion);
  let applied: Awaited<ReturnType<typeof applyFix>>;
  try {
    applied = await applyFix(admin, suggestion, { writesEnabled: true });
  } catch (error) {
    await releaseFix(db, id).catch(e => console.error("Releasing the fix reservation failed", e));
    throw error;
  }
  try {
    await completeFix(db, id, applied);
  } catch (error) {
    console.error("Recording the applied fix failed; reverting the store change", error);
    await admin.setDescription(suggestion.productId, applied.beforeHtml).catch(e => console.error("Reverting the store change failed", e));
    await releaseFix(db, id).catch(() => {});
    throw new Error("The fix couldn't be recorded, so the store change was reverted. Try again.");
  }
  return { id };
}

/** Undoes the store's applied fix, unless the description was edited since. */
export async function undoWeeklyFix(shop: string, graphql: AdminGraphql) {
  const db = getDb();
  if (!db) throw new Error("The database is not connected. Set DATABASE_URL and restart the app.");
  const current = await latestFix(db, shop);
  if (!current || current.status !== "applied") throw new Error("There is no applied fix to undo.");
  // "already_undone": the store is back to the old text (an earlier undo wasn't recorded); record it now.
  await undoFix(shopifyProductAdmin(runnerFor(graphql)), current, { writesEnabled: storeWritesEnabled(process.env) });
  if (!(await markFixUndone(db, current.id))) throw new Error("This fix was already undone.");
  return { id: current.id };
}

// ---------------------------------------------------------------------------------------------
// Ask Centurion (Meta Muse Spark over the store's Centurion data, read-only)
// ---------------------------------------------------------------------------------------------

export { ASSISTANT_SUGGESTIONS };

/** What the assistant reads: this store's report when it has AI orders, otherwise the labeled Northpine sample. */
async function assistantContext(shop: string) {
  const report = await latestReport(shop);
  const ownView = report.configured ? report.view : null;
  const demo = Boolean(report.demo);
  const check = await answerCheckState(shop);
  const answerCheck = demo ? (check.demo?.run ?? check.run) : (check.run && check.run.contradictions > 0 ? check.run : (check.demo?.run ?? check.run));
  return { view: demo ? report.demo : ownView, answerCheck, demo };
}

export async function assistantState(shop: string) {
  const ctx = await assistantContext(shop);
  return { live: isMetaLive(process.env), demo: ctx.demo, storeName: ctx.view?.store.name ?? shop, suggestions: ASSISTANT_SUGGESTIONS };
}

export async function askStore(shop: string, question: string, history: AssistantTurn[]) {
  return askAssistant({ question, history, context: await assistantContext(shop) });
}

/** Rich answer (headline, metrics, chart, table, actions) for the Shopify Ask Centurion page. */
export async function askStoreRich(shop: string, question: string, history: AssistantTurn[]): Promise<AssistantReply> {
  const ctx = await assistantContext(shop);
  return (await askAssistantRich({ question, history, context: { ...ctx, screen: "AI Sales" } })).reply;
}

export type ShopCard =
  | { type: "fix"; product: string; addition: string; before: string; aiRevenue: number; periodDays: number; finding: { provider: string; said: string; truth: string } | null; holdouts: string[]; live: boolean }
  | { type: "answer_check"; asked: number; matched: number; wrong: number; noAnswer: number; top: { product: string; assistant: string; said: string; truth: string }[] }
  | { type: "checkout"; run: CheckoutRunResult }
  | { type: "csv"; filename: string; rows: number; csv: string }
  | { type: "navigate"; href: string; label: string };

const demoFixtureCheck = () => runAnswerCheck({ catalog: DEMO_NORTHPINE_CATALOG, providers: createAnswerProviders({}) });
const demoSuggestionFix = async () => suggestFix({ sales: DEMO_SALES_SNAPSHOT, answerCheck: await demoFixtureCheck(), catalog: DEMO_NORTHPINE_CATALOG });

/** Runs one Ask Centurion action. Fixed code; the model only picks the id. */
export async function runStoreAction(shop: string, id: string): Promise<ShopCard> {
  switch (id) {
    case "draft_fix": {
      const s = await demoSuggestionFix();
      if (!s) throw new Error("Nothing to fix this week: AI gets no top seller wrong.");
      return {
        type: "fix",
        product: s.productTitle,
        addition: s.addition,
        before: DEMO_NORTHPINE_CATALOG.products.find(p => p.id === s.productId)?.description ?? "",
        aiRevenue: s.evidence.aiRevenue,
        periodDays: s.evidence.periodDays,
        finding: s.evidence.findings[0] ?? null,
        holdouts: s.holdouts.map(h => h.title),
        live: writesOn(process.env)
      };
    }
    case "run_answer_check": {
      const run = await demoFixtureCheck();
      return {
        type: "answer_check",
        asked: run.asked,
        matched: run.consistent,
        wrong: run.contradictions,
        noAnswer: run.noAnswer,
        top: findings(run).slice(0, 4).map(r => ({ product: r.subject, assistant: r.providerLabel, said: r.issues[0]?.said ?? "", truth: r.issues[0]?.truth ?? "" }))
      };
    }
    case "watch_checkout":
      return { type: "checkout", run: TEST_PAGE_CHECKOUT_RUN };
    case "export_ai_orders": {
      const view = (await assistantContext(shop)).view;
      const cell = (v: unknown) => (/[",\n]/.test(String(v ?? "")) ? `"${String(v ?? "").replace(/"/g, '""')}"` : String(v ?? ""));
      const rows = (view?.aiOrders ?? []).map(o => [o.name, o.createdAt.slice(0, 10), o.source, o.total, o.evidence, o.touch, o.proof.join(" | ")]);
      const csv = [["order", "date", "assistant", "total", "evidence", "journey", "proof"], ...rows].map(r => r.map(cell).join(",")).join("\n");
      return { type: "csv", filename: `ai-orders-${view?.report.period.to ?? "export"}.csv`, rows: rows.length, csv };
    }
    default: {
      const href = { open_ai_sales: "/app", open_answer_check: "/app/answer-check", open_weekly_fix: "/app/weekly-fix" }[id];
      if (!href) throw new Error("Unknown action.");
      return { type: "navigate", href, label: href };
    }
  }
}

/** Applies the demo fix to this store's copy of the product (created on first use) through the merchant's session. */
export async function applyStoreFix(shop: string, graphql: AdminGraphql) {
  const s = await demoSuggestionFix();
  const product = DEMO_NORTHPINE_CATALOG.products.find(p => p.id === s?.productId);
  if (!s || !product) throw new Error("There is no fix to apply.");
  return applyFixLive(runnerFor(graphql), shop, s, product);
}

export async function undoStoreFix(graphql: AdminGraphql, input: { productId: string; beforeHtml: string; afterHtml: string }) {
  const s = await demoSuggestionFix();
  if (!s) throw new Error("There is no fix to undo.");
  return undoFixLive(runnerFor(graphql), { ...input, suggestion: s });
}
