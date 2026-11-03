import { shortDate, TEST_PAGE_CHECKOUT_RUN as run, type CheckoutStepStatus } from "@centurion/core";

export const metadata = { title: "Checkout Test · Centurion" };

const STATUS: Record<CheckoutStepStatus, { cls: string; mark: string; label: string }> = {
  passed: { cls: "ok", mark: "✓", label: "Passed" },
  slowed: { cls: "warn", mark: "!", label: "Slowed the agent" },
  blocked: { cls: "bad", mark: "✕", label: "Blocked the agent" }
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** A real run of the checkout agent (packages/checkout-test) on its local test page, committed as data. */
export default function CheckoutTestPage() {
  const total = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  const outcome =
    run.result === "reached_checkout"
      ? `Reached checkout in ${run.steps.length} steps and stopped before payment.`
      : `Blocked at step ${run.failedStep}.`;

  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Agent Checkout Test · {shortDate(run.startedAt)} · test page</p>
        <p className="hero-number">
          {run.problems} {run.problems === 1 ? "problem" : "problems"}
        </p>
        <p>An AI shopping agent tried to buy from the test store. {outcome}</p>
      </section>

      <span className="preview">
        Test-page run · a real run of the checkout agent on a local practice store (popup and unlabeled size picker switched on), not on
        Northpine or any real shop.
      </span>

      <section className="card">
        <h2>The recording</h2>
        <div className="video">
          The worker records a video of every run (Playwright, saved next to the worker). Videos stay on the machine that ran the test and
          aren’t published with this demo.
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Agent: {run.agent}. Run time {seconds(total)}.{run.query ? ` Shopper looked for “${run.query}”.` : ""}
        </p>
      </section>

      <section className="card">
        <h2>Step by step</h2>
        <ol className="steps">
          {run.steps.map(s => {
            const st = STATUS[s.status];
            return (
              <li key={s.n}>
                <span className="step-n">{s.n}</span>
                <div>
                  <div className="step-head">
                    <span>{s.title}</span>
                    <span className={`status ${st.cls}`}>
                      <span aria-hidden="true">{st.mark}</span> {st.label}
                    </span>
                  </div>
                  <p className="step-body">
                    {s.detail} <span className="muted">({seconds(s.ms)})</span>
                  </p>
                  {s.hint ? (
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
