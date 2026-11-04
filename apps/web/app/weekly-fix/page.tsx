import {
  createAnswerProviders,
  DEMO_NORTHPINE_CATALOG,
  DEMO_SALES_SNAPSHOT,
  explainFix,
  runAnswerCheck,
  suggestFix
} from "@centurion/core/server";
import { FixActions } from "@/components/FixActions";
import { money } from "@/lib/data";

export const metadata = { title: "Weekly Fix · Centurion" };

// Rebuilt at most hourly, like Answer Check, so a META_API_KEY added later rewrites the explanation.
export const revalidate = 3600;

/**
 * The real Weekly Fix rule on demo data: AI Sales numbers from the demo report and the Answer Check run
 * on the demo catalog. Apply and undo here change a copy of the description in the browser only.
 */
export default async function WeeklyFixPage() {
  // Always the demo store's numbers: the demo catalog's products only exist there, even in live mode.
  const answerCheck = await runAnswerCheck({ catalog: DEMO_NORTHPINE_CATALOG, providers: createAnswerProviders(process.env) });
  const chosen = suggestFix({ sales: DEMO_SALES_SNAPSHOT, answerCheck, catalog: DEMO_NORTHPINE_CATALOG });
  const suggestion = chosen ? await explainFix(chosen) : null;

  if (!suggestion) {
    return (
      <div className="stack">
        <section className="hero">
          <p className="eyebrow">This week’s fix</p>
          <p className="hero-number" style={{ fontSize: 32 }}>
            Nothing to fix this week
          </p>
          <p>AI got no catalog facts wrong about the products it sells.</p>
        </section>
      </div>
    );
  }

  const before = DEMO_NORTHPINE_CATALOG.products.find(p => p.id === suggestion.productId)?.description ?? "";
  const finding = suggestion.evidence.findings[0]!;

  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">This week’s fix</p>
        <p className="hero-number" style={{ fontSize: 32 }}>
          Clear up what AI gets wrong about the {suggestion.productTitle}
        </p>
        <p>One small change, chosen by a fixed rule from this week’s AI Sales and Answer Check results. Apply it in one click, undo it any time.</p>
      </section>

      <span className="preview">
        Demo store · the rule is real; the answers it reacts to are {answerCheck.mode === "fixture" ? "labeled fixture answers" : "live Meta Muse Spark answers"} about
        the fictional Northpine catalog. Apply and undo change a copy in your browser, never a real store.
      </span>

      <section className="card">
        <h2>Why this one</h2>
        <div className="kv">
          <span>AI is already selling it</span>
          <span className="num">
            {money(suggestion.evidence.aiRevenue)} from AI in {suggestion.evidence.periodDays} days ({suggestion.evidence.aiUnits} units)
          </span>
        </div>
        <div className="kv">
          <span>AI gets a fact wrong</span>
          <span>
            {finding.provider}
            {answerCheck.mode === "fixture" ? " (fixture)" : ""}: “{finding.said}” Catalog: {finding.truth}
          </span>
        </div>
        <div className="kv">
          <span>Picked because</span>
          <span>Most AI revenue among products AI gets wrong</span>
        </div>
        <p className="sub" style={{ marginTop: 12 }}>
          {suggestion.explanation}{" "}
          <span className="muted">({suggestion.explanationBy === "meta" ? "worded by Meta Muse Spark" : "template wording"})</span>
        </p>
      </section>

      <section className="card">
        <h2>The change</h2>
        <p className="muted">{suggestion.productTitle} · top of the product description</p>
        <FixActions before={before} addition={suggestion.addition} holdouts={suggestion.holdouts.map(h => h.title)} />
      </section>
    </div>
  );
}
