import {
  createAnswerProviders,
  DEMO_NORTHPINE_CATALOG,
  findings,
  runAnswerCheck,
  type AnswerStatus,
  type Severity
} from "@centurion/core/server";
import { shortDate } from "@/lib/data";

export const metadata = { title: "Answer Check · Centurion" };

const SEVERITY: Record<Severity, { cls: string; label: string }> = {
  high: { cls: "bad", label: "High: banned claim or wrong fact" },
  medium: { cls: "warn", label: "Medium: misleading or out of date" }
};

const STATUS: Record<AnswerStatus, { cls: string; label: string }> = {
  consistent: { cls: "ok", label: "Matches catalog" },
  contradiction: { cls: "bad", label: "Contradicts catalog" },
  no_answer: { cls: "", label: "Didn’t answer" },
  error: { cls: "warn", label: "Model error" }
};

/**
 * Runs the real Answer Check pipeline on the Northpine demo catalog. Without META_API_KEY every
 * provider returns labeled fixture answers and no model is called; with it, Meta Llama answers live.
 */
export default async function AnswerCheckPage() {
  const run = await runAnswerCheck({ catalog: DEMO_NORTHPINE_CATALOG, providers: createAnswerProviders(process.env) });
  const wrong = findings(run);
  const providers = run.providers.map(p => (p.mode === "fixture" ? `${p.label} (fixture)` : `${p.label} · ${p.model}`)).join(", ");

  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">
          AI Answer Check · {shortDate(run.generatedAt)} · {run.mode === "live" ? "live" : "fixture run"}
        </p>
        <p className="hero-number">{run.contradictions} wrong answers</p>
        <p>
          We asked {run.asked} questions shoppers ask about {run.store.name}’s best sellers and policies. {run.consistent} answers matched
          the catalog, {run.contradictions} contradicted it and {run.noAnswer} didn’t answer
          {run.errors > 0 ? `; ${run.errors} failed with a model error` : ""}. Every answer is checked against the catalog by fixed
          rules, not by a model.
        </p>
      </section>

      {run.mode === "fixture" ? (
        <span className="preview">
          Fixture data · no META_API_KEY is set, so these are written sample answers, not real model output. The catalog comparison is
          real. Assistants: {providers}.
        </span>
      ) : (
        <span className="preview">Live · answers from {providers} through the official API.</span>
      )}

      {wrong.flatMap(r =>
        r.issues.map((issue, i) => {
          const sev = SEVERITY[issue.severity];
          return (
            <section className="card" key={`${r.provider}-${r.questionId}-${i}`}>
              <div className="step-head">
                <h2 style={{ marginBottom: 0 }}>{r.subject}</h2>
                <span className={`status ${sev.cls}`}>{sev.label}</span>
              </div>
              <p className="sub" style={{ marginTop: 4 }}>
                {r.providerLabel}
                {run.mode === "fixture" ? " (fixture)" : ""} · Asked: “{r.question}”
              </p>
              <div className="compare">
                <div className="said">
                  <p className="lbl">AI said</p>
                  <p>{issue.said}</p>
                </div>
                <div className="truth">
                  <p className="lbl">Your catalog says</p>
                  <p>{issue.truth}</p>
                  <p className="muted" style={{ marginTop: 6 }}>
                    Source: {issue.source}
                  </p>
                </div>
              </div>
              <p className="hint">
                <b>Why it matters:</b> {issue.why}
              </p>
            </section>
          );
        })
      )}

      <section className="card">
        <h2>Every answer</h2>
        {run.results.map(r => (
          <div className="kv" key={`${r.provider}-${r.questionId}`}>
            <span>
              {r.question}
              <br />
              <span className="muted">
                {r.providerLabel}: {r.answer ?? r.error}
              </span>
            </span>
            <span className={`status ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
