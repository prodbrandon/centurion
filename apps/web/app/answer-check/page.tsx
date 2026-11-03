import { answerCheck, shortDate, type Severity } from "@centurion/core";

export const metadata = { title: "Answer Check · Centurion" };

const SEVERITY: Record<Severity, { cls: string; label: string }> = {
  high: { cls: "bad", label: "High: banned claim or wrong fact" },
  medium: { cls: "warn", label: "Medium: misleading or underselling" }
};

export default function AnswerCheckPage() {
  const wrong = answerCheck.asked - answerCheck.matched;
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">AI Answer Check · {shortDate(answerCheck.date)}</p>
        <p className="hero-number">{wrong} wrong answers</p>
        <p>
          We asked AI {answerCheck.asked} questions shoppers ask about your best sellers and policies. {answerCheck.matched}{" "}
          answers matched your catalog. These {wrong} didn’t.
        </p>
      </section>

      <span className="preview">Preview · sample answers. Live checks will call models through official APIs only.</span>

      {answerCheck.findings.map(f => {
        const sev = SEVERITY[f.severity];
        return (
          <section className="card" key={f.question}>
            <div className="step-head">
              <h2 style={{ marginBottom: 0 }}>{f.product}</h2>
              <span className={`status ${sev.cls}`}>{sev.label}</span>
            </div>
            <p className="sub" style={{ marginTop: 4 }}>
              Asked: “{f.question}”
            </p>
            <div className="compare">
              <div className="said">
                <p className="lbl">AI said</p>
                <p>{f.said}</p>
              </div>
              <div className="truth">
                <p className="lbl">Your catalog says</p>
                <p>{f.truth}</p>
                <p className="muted" style={{ marginTop: 6 }}>
                  Source: {f.source}
                </p>
              </div>
            </div>
            <p className="hint">
              <b>Why it matters:</b> {f.why}
            </p>
          </section>
        );
      })}
    </div>
  );
}
