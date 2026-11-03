import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { money, REPORT_DAYS, weeklyFix } from "@centurion/core";
import { authenticate } from "../shopify.server";
import { latestReport } from "../centurion.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const state = await latestReport(session.shop);
  // Real engine number for this product when the store has it; null otherwise.
  const sales = state.configured ? (state.view?.report.top_products.find(p => p.title === weeklyFix.product) ?? null) : null;
  return { sales };
};

export default function WeeklyFix() {
  const { sales } = useLoaderData<typeof loader>();
  const [applied, setApplied] = useState<string | null>(null);

  return (
    <s-page heading="This week’s fix">
      <s-banner tone="info" heading="Preview">
        <s-paragraph>The fix is drafted by Llama in the live version. Apply and undo here change nothing in your store yet.</s-paragraph>
      </s-banner>

      <s-section heading={weeklyFix.title}>
        <s-paragraph>One small change, picked from what we found this week. Apply it in one click, undo it any time.</s-paragraph>
      </s-section>

      <s-section heading="Why this one">
        <s-stack gap="small-200">
          {sales ? (
            <s-paragraph>
              AI is already selling it: {money(sales.revenue)} from AI in {REPORT_DAYS} days ({sales.units} units).
            </s-paragraph>
          ) : null}
          <s-paragraph>AI gets a key fact wrong: it says “waterproof”, your lab results say it isn’t.</s-paragraph>
          <s-paragraph>Risk if left alone: returns from shoppers who bought it for heavy rain.</s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="The change">
        <s-stack gap="base">
          <s-text color="subdued">
            {weeklyFix.product} · {weeklyFix.field}
          </s-text>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="small-300">
                <s-text type="strong">Before</s-text>
                <s-text>{weeklyFix.before}</s-text>
              </s-stack>
            </s-box>
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack gap="small-300">
                <s-text type="strong">After</s-text>
                <s-text>{weeklyFix.after}</s-text>
              </s-stack>
            </s-box>
          </s-grid>
          {applied ? (
            <s-stack gap="small-200">
              <s-badge tone="success">Applied {applied}</s-badge>
              <s-paragraph>
                Next week we compare AI orders for this product with products we held back ({weeklyFix.holdouts.join(", ")}), so you
                see the real effect, not a guess.
              </s-paragraph>
              <s-button onClick={() => setApplied(null)}>Undo</s-button>
            </s-stack>
          ) : (
            <s-button
              variant="primary"
              onClick={() =>
                setApplied(new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))
              }
            >
              Apply this fix
            </s-button>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
