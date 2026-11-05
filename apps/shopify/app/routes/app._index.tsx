import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { EVIDENCE_WORDS, money, REPORT_DAYS, shortDate, TOUCH_WORDS, type AiSalesView } from "@centurion/core";
import { authenticate, unauthenticated } from "../shopify.server";
import { latestReport, runErrorMessage, startReport } from "../centurion.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return latestReport(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    const result = await startReport({
      shop: session.shop,
      scope: session.scope,
      graphql: admin.graphql,
      // A fresh client per page: it refreshes the store's offline token if a long run outlives it.
      adminGraphql: async () => (await unauthenticated.admin(session.shop)).admin.graphql
    });
    return { ok: true as const, ...result };
  } catch (error) {
    console.error("Starting the report failed", error);
    return { ok: false as const, error: runErrorMessage(error) };
  }
};

export default function AiSales() {
  const state = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const run = state.configured ? state.run : null;
  const inBackground = run?.status === "running";
  const running = fetcher.state !== "idle" || inBackground;

  // The report runs in the background; reload the stored state every 2 seconds until it finishes.
  useEffect(() => {
    if (!inBackground) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 2000);
    return () => clearInterval(timer);
  }, [inBackground, revalidator]);

  // Toast once when the run this page started (or joined) reaches a final status.
  const started = fetcher.data?.ok ? fetcher.data.runId : null;
  const toasted = useRef<string | null>(null);
  useEffect(() => {
    if (!started || toasted.current === started || run?.id !== started || run.status === "running") return;
    toasted.current = started;
    if (run.status === "done" && state.configured && state.view) {
      shopify.toast.show(`Report done: ${state.view.report.ai.orders} AI orders of ${state.view.report.orders}`);
    } else if (run.status === "failed") {
      shopify.toast.show("Report failed", { isError: true });
    }
  }, [started, run, state, shopify]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.ok) shopify.toast.show("Report failed to start", { isError: true });
  }, [fetcher.state, fetcher.data, shopify]);

  const runButton = (
    <s-button
      slot="primary-action"
      variant="primary"
      onClick={() => fetcher.submit({}, { method: "POST" })}
      {...(running ? { loading: true } : {})}
      {...(!state.configured ? { disabled: true } : {})}
    >
      Run Report
    </s-button>
  );

  return (
    <s-page heading="AI Sales">
      {runButton}
      {fetcher.data && !fetcher.data.ok ? (
        <s-banner tone="critical" heading="The report didn't start">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      ) : null}
      {inBackground ? (
        <s-banner tone="info" heading="Report running">
          <s-paragraph>
            {fetcher.data?.ok && fetcher.data.alreadyRunning ? "A report was already running, so this page is following it. " : ""}
            Reading your last {REPORT_DAYS} days of orders, started{" "}
            {new Date(run.startedAt).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" })} UTC. You can
            leave this page; the report keeps running and appears here when it’s done.
          </s-paragraph>
        </s-banner>
      ) : run?.status === "failed" ? (
        <s-banner tone="critical" heading="The last report didn't finish">
          <s-paragraph>
            {run.error ?? "Unknown error."} {state.configured && state.view ? "Showing the last report that finished." : ""}
          </s-paragraph>
        </s-banner>
      ) : null}
      {!state.configured ? (
        <s-banner tone="critical" heading="Database not connected">
          <s-paragraph>Set DATABASE_URL in apps/shopify/.env, then restart `shopify app dev`.</s-paragraph>
        </s-banner>
      ) : state.error ? (
        <s-banner tone="critical" heading="Can't reach the database">
          <s-paragraph>{state.error} Then restart `shopify app dev`.</s-paragraph>
        </s-banner>
      ) : !state.view ? (
        <s-section heading="No report yet">
          <s-paragraph>
            Run the first report to see which orders ChatGPT, Perplexity, Gemini and other AI assistants sent you, with proof for
            each one. It reads your last {REPORT_DAYS} days of orders and changes nothing in your store.
          </s-paragraph>
        </s-section>
      ) : (
        <Report view={state.view} />
      )}
      {state.demo ? (
        <>
          <s-banner tone="info" heading="Sample report: Northpine Outfitters, a fictional store">
            <s-paragraph>
              Your store has no AI orders to show yet, so this is what the report looks like on sample data: {state.demo.report.orders}{" "}
              orders over 90 days, run through the same engine. None of these numbers are your store’s. Your own report replaces this
              as soon as AI assistants send you orders.
            </s-paragraph>
          </s-banner>
          <Report view={state.demo} />
        </>
      ) : null}
    </s-page>
  );
}

function Report({ view }: { view: AiSalesView }) {
  const r = view.report;
  if (r.orders === 0) {
    return (
      <s-section heading="No orders in this period">
        <s-paragraph>The last report found no orders in the last {REPORT_DAYS} days. Run it again once the store has orders.</s-paragraph>
      </s-section>
    );
  }
  return (
    <>
      <s-section heading={`AI sent ${r.ai.orders} orders worth ${money(r.ai.revenue)}`}>
        <s-stack gap="small-200">
          <s-paragraph>
            That is {r.ai.share_of_revenue}% of revenue from {shortDate(r.period.from)} to {shortDate(r.period.to)}. AI orders
            average {money(r.ai.avg_order_value)} vs {money(r.ai.non_ai_avg_order_value)} for everything else.
          </s-paragraph>
          <s-text color="subdued">
            Updated {new Date(view.generatedAt).toLocaleString("en-US")} · AI source list v{view.signaturesVersion}
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Demand by AI agent">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Assistant</s-table-header>
            <s-table-header format="numeric">Orders</s-table-header>
            <s-table-header format="numeric">Revenue</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {r.by_source.map(s => (
              <s-table-row key={s.source}>
                <s-table-cell>{s.label}</s-table-cell>
                <s-table-cell>{s.orders}</s-table-cell>
                <s-table-cell>{money(s.revenue)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Agent-assisted journeys">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Path</s-table-header>
            <s-table-header format="numeric">Orders</s-table-header>
            <s-table-header format="numeric">Revenue</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {r.by_touch.map(t => (
              <s-table-row key={t.touch}>
                <s-table-cell>{TOUCH_WORDS[t.touch] ?? t.touch}</s-table-cell>
                <s-table-cell>{t.orders}</s-table-cell>
                <s-table-cell>{money(t.revenue)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Products agents recommend most">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Product</s-table-header>
            <s-table-header format="numeric">Units</s-table-header>
            <s-table-header format="numeric">Revenue</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {r.top_products.slice(0, 5).map(p => (
              <s-table-row key={p.title}>
                <s-table-cell>{p.title}</s-table-cell>
                <s-table-cell>{p.units}</s-table-cell>
                <s-table-cell>{money(p.revenue)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="AI revenue trajectory">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Week of</s-table-header>
            <s-table-header format="numeric">AI revenue</s-table-header>
            <s-table-header format="numeric">All revenue</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {r.weekly.map(w => (
              <s-table-row key={w.week_start}>
                <s-table-cell>{shortDate(w.week_start)}</s-table-cell>
                <s-table-cell>{money(w.ai_revenue)}</s-table-cell>
                <s-table-cell>{money(w.total_revenue)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Attribution ledger: every AI order, with evidence">
        <s-stack gap="base">
          <s-paragraph>
            Each order shows exactly why we counted it, so you can check it in Shopify.{" "}
            {r.by_evidence.map(e => `${EVIDENCE_WORDS[e.evidence] ?? e.evidence}: ${e.orders}`).join(" · ")}.
          </s-paragraph>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header listSlot="secondary">Assistant</s-table-header>
              <s-table-header>Proof</s-table-header>
              <s-table-header format="numeric">Total</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {view.aiOrders.map(o => (
                <s-table-row key={o.name}>
                  <s-table-cell>
                    {o.name} · {shortDate(o.createdAt)}
                  </s-table-cell>
                  <s-table-cell>{o.source}</s-table-cell>
                  <s-table-cell>
                    <s-stack gap="small-300">
                      <s-text type="strong">
                        {EVIDENCE_WORDS[o.evidence ?? ""] ?? o.evidence} · {TOUCH_WORDS[o.touch ?? ""] ?? o.touch}
                      </s-text>
                      {o.proof.map(p => (
                        <s-text key={p} color="subdued">
                          {p}
                        </s-text>
                      ))}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{money(o.total)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>

      <s-section heading="Unattributed signal: likely AI, not counted">
        <s-paragraph>
          {view.candidates.orders} orders ({money(view.candidates.revenue)}) came in “direct” straight to a product page. AI links
          often look like this when the referrer is stripped, but we can’t prove it, so we never count them as AI sales.
        </s-paragraph>
      </s-section>
    </>
  );
}

export const headers: HeadersFunction = headersArgs => boundary.headers(headersArgs);
