import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { shortDate, type CheckoutStepStatus } from "@centurion/core";
import { authenticate } from "../shopify.server";
import { checkoutTestState } from "../centurion.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return checkoutTestState(session.shop);
};

const STATUS: Record<CheckoutStepStatus, { tone: "success" | "warning" | "critical"; label: string }> = {
  passed: { tone: "success", label: "Passed" },
  slowed: { tone: "warning", label: "Slowed the agent" },
  blocked: { tone: "critical", label: "Blocked the agent" }
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export default function CheckoutTest() {
  const { run, source } = useLoaderData<typeof loader>();
  const total = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  const outcome =
    run.result === "reached_checkout"
      ? `Reached checkout in ${run.steps.length} steps and stopped before payment.`
      : `Blocked at step ${run.failedStep}: ${run.steps.find(s => s.n === run.failedStep)?.title ?? ""}.`;

  return (
    <s-page heading="Agent Checkout Test">
      {source === "shop" ? (
        <s-banner tone="info" heading="Run on your storefront">
          <s-paragraph>The agent shopped {run.target.url} and stopped before payment. It never submits a payment.</s-paragraph>
        </s-banner>
      ) : (
        <s-banner tone="warning" heading="Test-page run, not your store">
          <s-paragraph>
            This is a real run of the checkout agent on Centurion’s local test page, a small practice store, not on your shop. Your
            own storefront hasn’t been tested yet: run{" "}
            <s-text type="strong">npm run check -- --url your-store-url --shop your-shop.myshopify.com</s-text> in
            packages/checkout-test.
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading={`${run.problems} ${run.problems === 1 ? "problem" : "problems"} · ${shortDate(run.startedAt)}`}>
        <s-stack gap="small-200">
          <s-paragraph>
            A scripted shopping agent tried to buy from {run.target.kind === "test_page" ? "the test page" : "your store"}. {outcome}
          </s-paragraph>
          <s-text color="subdued">
            Agent: {run.agent}. Run time {seconds(total)}.
            {run.query ? ` Shopper looked for “${run.query}”.` : ""}
            {run.blockedRequests.length ? ` Payment requests stopped: ${run.blockedRequests.join(", ")}.` : ""}
          </s-text>
          <s-text color="subdued">
            {run.videoPath
              ? `Video saved by the worker as ${run.videoPath}, on the machine that ran it.`
              : "The worker saves a video of each run where it runs; videos aren’t uploaded."}
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Step by step">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Step</s-table-header>
            <s-table-header listSlot="secondary">Result</s-table-header>
            <s-table-header>What happened</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {run.steps.map(s => {
              const st = STATUS[s.status];
              return (
                <s-table-row key={s.n}>
                  <s-table-cell>
                    {s.n}. {s.title}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={st.tone}>{st.label}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="small-300">
                      <s-text>
                        {s.detail} <s-text color="subdued">({seconds(s.ms)})</s-text>
                      </s-text>
                      {s.hint ? <s-text type="strong">Fix: {s.hint}</s-text> : null}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = headersArgs => boundary.headers(headersArgs);
