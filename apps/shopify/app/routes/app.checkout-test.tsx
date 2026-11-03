import { checkoutRun, shortDate, type StepStatus } from "@centurion/core";

const STATUS: Record<StepStatus, { tone: "success" | "warning" | "critical"; label: string }> = {
  passed: { tone: "success", label: "Passed" },
  slowed: { tone: "warning", label: "Slowed the agent" },
  blocked: { tone: "critical", label: "Blocked the agent" }
};

export default function CheckoutTest() {
  return (
    <s-page heading="Agent Checkout Test">
      <s-banner tone="info" heading="Preview">
        <s-paragraph>Sample run. The live Llama agent is being built now and will test your own store.</s-paragraph>
      </s-banner>

      <s-section heading={`${checkoutRun.problems} problems · ${shortDate(checkoutRun.date)}`}>
        <s-stack gap="small-200">
          <s-paragraph>An AI shopping agent tried to buy from your store. {checkoutRun.result}</s-paragraph>
          <s-text color="subdued">
            Agent: {checkoutRun.agent}. Run time {checkoutRun.duration}.
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
            {checkoutRun.steps.map((s, i) => {
              const st = STATUS[s.status];
              return (
                <s-table-row key={s.title}>
                  <s-table-cell>
                    {i + 1}. {s.title}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={st.tone}>{st.label}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="small-300">
                      <s-text>{s.detail}</s-text>
                      {"hint" in s && s.hint ? <s-text type="strong">Fix: {s.hint}</s-text> : null}
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
