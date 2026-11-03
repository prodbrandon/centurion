import { answerCheck, shortDate, type Severity } from "@centurion/core";

const SEVERITY: Record<Severity, { tone: "critical" | "warning"; label: string }> = {
  high: { tone: "critical", label: "High: banned claim or wrong fact" },
  medium: { tone: "warning", label: "Medium: misleading or underselling" }
};

export default function AnswerCheck() {
  const wrong = answerCheck.asked - answerCheck.matched;
  return (
    <s-page heading="AI Answer Check">
      <s-banner tone="info" heading="Preview">
        <s-paragraph>Sample answers. Live checks will call models through official APIs only.</s-paragraph>
      </s-banner>

      <s-section heading={`${wrong} wrong answers · ${shortDate(answerCheck.date)}`}>
        <s-paragraph>
          We asked AI {answerCheck.asked} questions shoppers ask about your best sellers and policies. {answerCheck.matched} answers
          matched your catalog. These {wrong} didn’t.
        </s-paragraph>
      </s-section>

      {answerCheck.findings.map(f => {
        const sev = SEVERITY[f.severity];
        return (
          <s-section key={f.question} heading={f.product}>
            <s-stack gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-badge tone={sev.tone}>{sev.label}</s-badge>
                <s-text color="subdued">Asked: “{f.question}”</s-text>
              </s-stack>
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-box padding="base" background="subdued" borderRadius="base">
                  <s-stack gap="small-300">
                    <s-text type="strong">AI said</s-text>
                    <s-text>{f.said}</s-text>
                  </s-stack>
                </s-box>
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack gap="small-300">
                    <s-text type="strong">Your catalog says</s-text>
                    <s-text>{f.truth}</s-text>
                    <s-text color="subdued">Source: {f.source}</s-text>
                  </s-stack>
                </s-box>
              </s-grid>
              <s-paragraph>
                <s-text type="strong">Why it matters:</s-text> {f.why}
              </s-paragraph>
            </s-stack>
          </s-section>
        );
      })}
    </s-page>
  );
}
