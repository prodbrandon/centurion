import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { EVIDENCE_WORDS, money, REPORT_DAYS, shortDate, TOUCH_WORDS, type AiSalesView } from "@centurion/core";
import { authenticate } from "../shopify.server";
import { latestReport, runErrorMessage, runReport } from "../centurion.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return latestReport(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    const result = await runReport({ shop: session.shop, scope: session.scope, graphql: admin.graphql });
    return { ok: true as const, ...result };
  } catch (error) {
    console.error("Report run failed", error);
    return { ok: false as const, error: runErrorMessage(error) };
  }
};

export default function AiSales() {
  const state = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const running = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(`Report done: ${fetcher.data.aiOrders} AI orders of ${fetcher.data.orders}`);
    else shopify.toast.show("Report failed", { isError: true });
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
        <s-banner tone="critical" heading="The report didn't finish">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      ) : null}
      {!state.configured ? (
        <s-banner tone="critical" heading="Database not connected">
          <s-paragraph>Set DATABASE_URL in apps/shopify/.env or the repo root .env, then restart `shopify app dev`.</s-paragraph>
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

      <s-section heading="Which AI sent them">
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

      <s-section heading="How shoppers used AI">
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

      <s-section heading="Products AI sells most">
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

      <s-section heading="AI revenue by week">
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

      <s-section heading="Every AI order, with proof">
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

      <s-section heading="Not counted, but worth watching">
        <s-paragraph>
          {view.candidates.orders} orders ({money(view.candidates.revenue)}) came in “direct” straight to a product page. AI links
          often look like this when the referrer is stripped, but we can’t prove it, so we never count them as AI sales.
        </s-paragraph>
      </s-section>
    </>
  );
}

export const headers: HeadersFunction = headersArgs => boundary.headers(headersArgs);
