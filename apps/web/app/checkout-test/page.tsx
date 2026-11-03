import { checkoutRun, shortDate, type StepStatus } from "@centurion/core";

export const metadata = { title: "Checkout Test · Centurion" };

const STATUS: Record<StepStatus, { cls: string; mark: string; label: string }> = {
  passed: { cls: "ok", mark: "✓", label: "Passed" },
  slowed: { cls: "warn", mark: "!", label: "Slowed the agent" },
  blocked: { cls: "bad", mark: "✕", label: "Blocked the agent" }
};

export default function CheckoutTestPage() {
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Agent Checkout Test · {shortDate(checkoutRun.date)}</p>
        <p className="hero-number">{checkoutRun.problems} problems</p>
        <p>
          An AI shopping agent tried to buy from your store. {checkoutRun.result}
        </p>
      </section>

      <span className="preview">Preview · sample run. The live Llama agent is being built now.</span>

      <section className="card">
        <h2>The recording</h2>
        <div className="video">
          In the live version, a screen recording of the agent’s run plays here, so you can watch exactly where it got stuck.
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Agent: {checkoutRun.agent}. Run time {checkoutRun.duration}.
        </p>
      </section>

      <section className="card">
        <h2>Step by step</h2>
        <ol className="steps">
          {checkoutRun.steps.map((s, i) => {
            const st = STATUS[s.status];
            return (
              <li key={s.title}>
                <span className="step-n">{i + 1}</span>
                <div>
                  <div className="step-head">
                    <span>{s.title}</span>
                    <span className={`status ${st.cls}`}>
                      <span aria-hidden="true">{st.mark}</span> {st.label}
                    </span>
                  </div>
                  <p className="step-body">{s.detail}</p>
                  {"hint" in s && s.hint ? (
                    <p className="hint">
                      <b>Fix:</b> {s.hint}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
