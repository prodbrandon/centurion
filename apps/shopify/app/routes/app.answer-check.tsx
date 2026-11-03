import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { AnswerCheckRun, AnswerResult, AnswerStatus, Severity } from "@centurion/core";
import { authenticate } from "../shopify.server";
import { answerCheckState, runErrorMessage, runLiveAnswerCheck } from "../centurion.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return answerCheckState(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    return { ok: true as const, ...(await runLiveAnswerCheck({ shop: session.shop, graphql: admin.graphql })) };
  } catch (error) {
    console.error("Answer check failed", error);
    return { ok: false as const, error: runErrorMessage(error) };
  }
};

const SEVERITY: Record<Severity, { tone: "critical" | "warning"; label: string }> = {
  high: { tone: "critical", label: "High: banned claim or wrong fact" },
  medium: { tone: "warning", label: "Medium: misleading or out of date" }
};

const STATUS: Record<AnswerStatus, { tone: "success" | "critical" | "neutral" | "warning"; label: string }> = {
  consistent: { tone: "success", label: "Matches catalog" },
  contradiction: { tone: "critical", label: "Contradicts catalog" },
  no_answer: { tone: "neutral", label: "Didn’t answer" },
  error: { tone: "warning", label: "Model error" }
};

export default function AnswerCheck() {
  const state = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const running = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(`Check done: ${fetcher.data.contradictions} wrong of ${fetcher.data.asked} answers`);
    else shopify.toast.show("Check failed", { isError: true });
  }, [fetcher.state, fetcher.data, shopify]);

  const fresh = fetcher.data?.ok ? fetcher.data : null;
  const run = fresh?.run ?? state.run;
  const list = fresh?.findings ?? state.findings;

  return (
    <s-page heading="AI Answer Check">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => fetcher.submit({}, { method: "POST" })}
        {...(running ? { loading: true } : {})}
        {...(!state.live ? { disabled: true } : {})}
      >
        Ask Meta Llama now
      </s-button>

      {state.live ? null : (
        <s-banner tone="warning" heading="Fixture data: sample answers, not real model output">
          <s-paragraph>
            No META_API_KEY is set, so no model was called. These answers are written samples about Northpine Outfitters, a fictional
            store, labeled by the assistant they stand in for. The comparison with the catalog is the real check. Add META_API_KEY to
            ask Meta Llama about your own products.
          </s-paragraph>
        </s-banner>
      )}
      {fetcher.data && !fetcher.data.ok ? (
        <s-banner tone="critical" heading="The check didn't finish">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      ) : null}
      {state.error ? (
        <s-banner tone="critical" heading="Can't reach the database">
          <s-paragraph>{state.error}</s-paragraph>
        </s-banner>
      ) : null}

      {run ? (
        <Results run={run} findings={list} />
      ) : (
        <s-section heading="No check yet">
          <s-paragraph>
            Ask Meta Llama ({state.model}) the questions shoppers ask about your best sellers. Every answer is compared with your
            catalog by fixed rules, not by a model, and each wrong answer shows the fact and source it contradicts. This reads your
            products and changes nothing in your store.
          </s-paragraph>
        </s-section>
      )}
    </s-page>
  );
}

function Results({ run, findings }: { run: AnswerCheckRun; findings: AnswerResult[] }) {
  const providers = run.providers.map(p => `${p.label}${p.mode === "fixture" ? " (fixture)" : ` · ${p.model}`}`).join(", ");
  return (
    <>
      <s-section heading={`${run.contradictions} wrong answers out of ${run.asked}`}>
        <s-stack gap="small-200">
          <s-paragraph>
            We asked {run.asked} questions shoppers ask about {run.store.name}’s best sellers and policies. {run.consistent} answers matched
            the catalog, {run.contradictions} contradicted it, {run.noAnswer} didn’t answer
            {run.errors > 0 ? `, and ${run.errors} failed with a model error` : ""}.
          </s-paragraph>
          <s-text color="subdued">
            {run.mode === "live" ? "Live run" : "Fixture run"} · {new Date(run.generatedAt).toLocaleString("en-US")} · {providers}
            {run.demoCatalog ? " · demo catalog" : ""}
          </s-text>
        </s-stack>
      </s-section>

      {findings.flatMap(r =>
        r.issues.map((issue, i) => {
          const sev = SEVERITY[issue.severity];
          return (
            <s-section key={`${r.provider}-${r.questionId}-${i}`} heading={r.subject}>
              <s-stack gap="base">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-badge tone={sev.tone}>{sev.label}</s-badge>
                  <s-badge>{r.providerLabel}{run.mode === "fixture" ? " · fixture" : ""}</s-badge>
                  <s-text color="subdued">Asked: “{r.question}”</s-text>
                </s-stack>
                <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <s-stack gap="small-300">
                      <s-text type="strong">AI said</s-text>
                      <s-text>{issue.said}</s-text>
                    </s-stack>
                  </s-box>
                  <s-box padding="base" borderWidth="base" borderRadius="base">
                    <s-stack gap="small-300">
                      <s-text type="strong">Your catalog says</s-text>
                      <s-text>{issue.truth}</s-text>
                      <s-text color="subdued">Source: {issue.source}</s-text>
                    </s-stack>
                  </s-box>
                </s-grid>
                <s-paragraph>
                  <s-text type="strong">Why it matters:</s-text> {issue.why}
                </s-paragraph>
              </s-stack>
            </s-section>
          );
        })
      )}

      <s-section heading="Every answer">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Question</s-table-header>
            <s-table-header listSlot="secondary">Assistant</s-table-header>
            <s-table-header>Result</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {run.results.map(r => (
              <s-table-row key={`${r.provider}-${r.questionId}`}>
                <s-table-cell>
                  <s-stack gap="small-300">
                    <s-text>{r.question}</s-text>
                    <s-text color="subdued">{r.answer ?? r.error}</s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{r.providerLabel}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</s-badge>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </>
  );
}

export const headers: HeadersFunction = headersArgs => boundary.headers(headersArgs);
