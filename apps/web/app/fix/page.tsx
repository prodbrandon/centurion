import {
  createAnswerProviders,
  DEMO_NORTHPINE_CATALOG,
  DEMO_SALES_SNAPSHOT,
  liveStoreWrites,
  runAnswerCheck,
  suggestFix
} from "@centurion/core/server";
import { FixCard } from "@/components/assistant/Cards";
import { Reveal } from "@/components/Reveal";

export const metadata = { title: "Fix AI Answers · Centurion" };
export const dynamic = "force-dynamic";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const SEVERITY = { high: "High: banned claim or wrong fact", medium: "Medium: misleading or out of date" } as const;

/**
 * One screen for "what is AI telling shoppers that's wrong, and fix it": wrong answers ranked by the AI revenue of
 * the product, each next to the catalog fact and its source, with this week's fix ready to apply. Uses the labeled
 * sample answers on the demo catalog, so it renders instantly and the same way every time.
 */
export default async function FixAnswersPage() {
  const run = await runAnswerCheck({ catalog: DEMO_NORTHPINE_CATALOG, providers: createAnswerProviders({}) });
  const sales = new Map(DEMO_SALES_SNAPSHOT.top_products.map(p => [p.title, p]));
  const wrong = run.results.filter(r => r.status === "contradiction");
  const subjects = [...new Set(wrong.map(r => r.subject))];
  const rows = subjects
    .map(subject => ({ subject, sold: sales.get(subject), results: wrong.filter(r => r.subject === subject) }))
    .sort((a, b) => (b.sold?.revenue ?? -1) - (a.sold?.revenue ?? -1));
  const atRisk = rows.reduce((t, r) => t + (r.sold?.revenue ?? 0), 0);
  const fix = suggestFix({ sales: DEMO_SALES_SNAPSHOT, answerCheck: run, catalog: DEMO_NORTHPINE_CATALOG });
  const live = liveStoreWrites();

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>Fix AI Answers</h1>
          <p className="sub">Wrong AI answers ranked by the AI revenue at stake. Fix the top one in a click.</p>
        </div>
        <span className="tag">{run.asked} shopper questions checked</span>
      </section>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">AI revenue at stake</span>
          <b>{usd(atRisk)}</b>
          <span className="kpi-sub">on products AI describes wrongly</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Wrong answers</span>
          <b className="badn">{run.contradictions}</b>
          <span className="kpi-sub">of {run.asked} checked</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Matched your catalog</span>
          <b>{run.consistent}</b>
          <span className="kpi-sub">{run.noAnswer} didn’t answer</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Affected</span>
          <b>{rows.length}</b>
          <span className="kpi-sub">
            {rows.filter(r => r.sold).length} products · {rows.filter(r => !r.sold).length} policies
          </span>
        </div>
      </div>

      <p className="note">
        Answers are labeled samples standing in for ChatGPT, Perplexity, Gemini and Meta Muse Spark. Catalog facts, sources, AI revenue and the
        comparison are computed by the engine.
      </p>

      {fix ? (
        <Reveal>
          <section className="card spotlight">
            <FixCard
              card={{
                type: "fix",
                product: fix.productTitle,
                addition: fix.addition,
                before: DEMO_NORTHPINE_CATALOG.products.find(p => p.id === fix.productId)?.description ?? "",
                aiRevenue: fix.evidence.aiRevenue,
                periodDays: fix.evidence.periodDays,
                finding: fix.evidence.findings[0] ?? null,
                holdouts: fix.holdouts.map(h => h.title),
                live,
                shop: live ? (process.env.SHOPIFY_SHOP ?? null) : null
              }}
            />
          </section>
        </Reveal>
      ) : null}

      {rows.map((row, i) => (
        <Reveal key={row.subject} delay={i * 0.05}>
          <section className="card">
            <div className="card-head">
              <h2>{row.subject}</h2>
              <span className="muted">
                {row.sold ? `${usd(row.sold.revenue)} AI revenue · ${row.sold.units} units` : "Store policy · applies to every order"}
              </span>
            </div>
            <div className="stack" style={{ gap: 12, marginTop: 12 }}>
              {row.results.flatMap(r =>
                r.issues.map((issue, j) => (
                  <div key={`${r.provider}-${r.questionId}-${j}`} className="wrong">
                    <div className="wrong-meta">
                      <span className={`status ${issue.severity === "high" ? "bad" : "warn"}`}>{SEVERITY[issue.severity]}</span>
                      <span className="muted">
                        {r.providerLabel} · asked “{r.question}”
                      </span>
                    </div>
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
                    <p className="sub" style={{ marginTop: 8 }}>
                      {issue.why}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </Reveal>
      ))}
    </div>
  );
}
