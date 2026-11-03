import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { money, type FixSuggestion } from "@centurion/core";
import { authenticate } from "../shopify.server";
import { applyWeeklyFix, runErrorMessage, undoWeeklyFix, weeklyFixState } from "../centurion.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  return weeklyFixState(session.shop, admin.graphql);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    if (intent === "apply") return { ok: true as const, intent, ...(await applyWeeklyFix(session.shop, admin.graphql, String(form.get("key") ?? ""))) };
    if (intent === "undo") return { ok: true as const, intent, ...(await undoWeeklyFix(session.shop, admin.graphql)) };
    return { ok: false as const, error: "Unknown action." };
  } catch (error) {
    console.error(`Weekly fix ${intent} failed`, error);
    return { ok: false as const, error: runErrorMessage(error) };
  }
};

function Change({ suggestion, before }: { suggestion: FixSuggestion; before?: string }) {
  return (
    <s-stack gap="base">
      <s-text color="subdued">{suggestion.productTitle} · top of the product description</s-text>
      <s-grid gridTemplateColumns="1fr 1fr" gap="base">
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-stack gap="small-300">
            <s-text type="strong">Before</s-text>
            <s-text>{before ?? "Your current description, unchanged."}</s-text>
          </s-stack>
        </s-box>
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack gap="small-300">
            <s-text type="strong">After</s-text>
            <s-text>
              <s-text type="strong">{suggestion.addition}</s-text> {before ?? "Then your current description."}
            </s-text>
          </s-stack>
        </s-box>
      </s-grid>
    </s-stack>
  );
}

function Why({ suggestion }: { suggestion: FixSuggestion }) {
  return (
    <s-stack gap="small-200">
      <s-paragraph>{suggestion.explanation}</s-paragraph>
      <s-text color="subdued">
        AI revenue for this product: {money(suggestion.evidence.aiRevenue)} in {suggestion.evidence.periodDays} days. Holdouts:{" "}
        {suggestion.holdouts.map(h => `${h.title} (${money(h.aiRevenue)})`).join(", ") || "none"}. Chosen by a fixed rule; the wording is{" "}
        {suggestion.explanationBy === "meta" ? "by Meta Llama" : "from a template"}.
      </s-text>
    </s-stack>
  );
}

export default function WeeklyFix() {
  const state = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";
  const applied = state.current?.status === "applied" ? state.current : null;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(fetcher.data.intent === "apply" ? "Fix applied" : "Fix undone");
    else shopify.toast.show("That didn't work", { isError: true });
  }, [fetcher.state, fetcher.data, shopify]);

  const submit = (intent: "apply" | "undo") => fetcher.submit({ intent, key: state.suggestion?.key ?? "" }, { method: "POST" });

  return (
    <s-page heading="This week’s fix">
      {state.writesEnabled ? null : (
        <s-banner tone="warning" heading="Live store writes are off">
          <s-paragraph>
            Apply and undo go through the Shopify Admin API and are tested against a mocked API, but they stay off for this store until
            CENTURION_STORE_WRITES=on is set and the app has the write_products scope.
          </s-paragraph>
        </s-banner>
      )}
      {fetcher.data && !fetcher.data.ok ? (
        <s-banner tone="critical" heading="That didn't work">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      ) : null}
      {state.error ? (
        <s-banner tone="critical" heading="Couldn't choose this week's fix">
          <s-paragraph>{state.error}</s-paragraph>
        </s-banner>
      ) : null}

      {applied ? (
        <s-section heading={`Live now: ${applied.suggestion.productTitle}`}>
          <s-stack gap="base">
            <s-paragraph>
              Applied {new Date(applied.appliedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}:
              “{applied.suggestion.addition}”
            </s-paragraph>
            {state.measurement ? (
              <s-paragraph>
                AI revenue per day: {money(state.measurement.product.before)} → {money(state.measurement.product.after)} for this product,{" "}
                {money(state.measurement.holdouts.before)} → {money(state.measurement.holdouts.after)} for the holdouts. Difference:{" "}
                {state.measurement.lift >= 0 ? "+" : "−"}
                {money(Math.abs(state.measurement.lift))} a day, over {state.measurement.afterDays} days since the fix.
              </s-paragraph>
            ) : (
              <s-text color="subdued">Once AI orders come in after the fix, run AI Sales again to compare this product with its holdouts.</s-text>
            )}
            <s-button onClick={() => submit("undo")} {...(busy ? { loading: true } : {})} {...(!state.writesEnabled ? { disabled: true } : {})}>
              Undo
            </s-button>
          </s-stack>
        </s-section>
      ) : null}

      {state.suggestion ? (
        <>
          <s-section heading={`Clear up what AI gets wrong about the ${state.suggestion.productTitle}`}>
            <Why suggestion={state.suggestion} />
          </s-section>
          <s-section heading="The change">
            <s-stack gap="base">
              <Change suggestion={state.suggestion} />
              <s-button
                variant="primary"
                onClick={() => submit("apply")}
                {...(busy ? { loading: true } : {})}
                {...(!state.writesEnabled || applied ? { disabled: true } : {})}
              >
                Apply this fix
              </s-button>
            </s-stack>
          </s-section>
        </>
      ) : (
        <>
          <s-section heading="No fix for your store this week">
            <s-paragraph>{state.reason}</s-paragraph>
          </s-section>
          {state.demo ? (
            <s-section heading={`Example on the demo store: ${state.demo.suggestion.productTitle}`}>
              <s-stack gap="base">
                <s-banner tone="info" heading="Demo data">
                  <s-paragraph>
                    Northpine Outfitters is a fictional store. This example runs the same rule on its sample sales and the labeled sample
                    answers from Answer Check, to show what a fix looks like. It can’t be applied.
                  </s-paragraph>
                </s-banner>
                <Why suggestion={state.demo.suggestion} />
                <Change suggestion={state.demo.suggestion} before={state.demo.before} />
              </s-stack>
            </s-section>
          ) : null}
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = headersArgs => boundary.headers(headersArgs);
