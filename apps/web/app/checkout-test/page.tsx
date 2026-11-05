import { shortDate, TEST_PAGE_CHECKOUT_RUN as run, type CheckoutStepStatus } from "@centurion/core";
import { AgentReplay } from "@/components/AgentReplay";

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

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>Agent Checkout</h1>
          <p className="sub">Can an AI shopping agent buy from your store? Where it gets stuck, and the fix for each problem.</p>
        </div>
        <span className="tag">{shortDate(run.startedAt)} · test page</span>
      </section>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Result</span>
          <b>{run.result === "reached_checkout" ? "Reached checkout" : `Blocked at step ${run.failedStep}`}</b>
          <span className="kpi-sub">stopped before payment</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Problems</span>
          <b className={run.problems ? "badn" : ""}>{run.problems}</b>
          <span className="kpi-sub">steps that slowed or blocked the agent</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Steps</span>
          <b>{run.steps.length}</b>
          <span className="kpi-sub">{run.query ? `searched “${run.query}”` : "from home page"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Run time</span>
          <b>{seconds(total)}</b>
          <span className="kpi-sub">{run.blockedRequests.length ? `${run.blockedRequests.length} payment requests blocked` : "no payment attempted"}</span>
        </div>
      </div>

      <p className="note">
        Recorded run of the checkout agent on a local practice store with a popup and an unlabeled size picker switched on, not on Northpine or a
        real shop.
      </p>

      <section className="card">
        <h2>Watch the agent shop</h2>
        <p className="sub" style={{ marginBottom: 16 }}>
          A replay of the recorded run: what the agent saw at each step, where it got stuck, and the fix for each problem.
        </p>
        <AgentReplay run={run} />
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
