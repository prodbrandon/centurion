import { weeklyFix } from "@centurion/core";
import { FixActions } from "@/components/FixActions";
import { getAiSales, money } from "@/lib/data";

export const metadata = { title: "Weekly Fix · Centurion" };

export default async function WeeklyFixPage() {
  // Real engine number: AI revenue for this product in the report period.
  const { view } = await getAiSales();
  const sales = view?.report.top_products.find(p => p.title === weeklyFix.product);

  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">This week’s fix</p>
        <p className="hero-number" style={{ fontSize: 32 }}>
          {weeklyFix.title}
        </p>
        <p>One small change, picked from what we found this week. Apply it in one click, undo it any time.</p>
      </section>

      <span className="preview">Preview · the fix is drafted by Llama in the live version.</span>

      <section className="card">
        <h2>Why this one</h2>
        {sales ? (
          <div className="kv">
            <span>AI is already selling it</span>
            <span className="num">
              {money(sales.revenue)} from AI in 90 days ({sales.units} units)
            </span>
          </div>
        ) : null}
        <div className="kv">
          <span>AI gets a key fact wrong</span>
          <span>AI says “waterproof”, your lab results say it isn’t</span>
        </div>
        <div className="kv">
          <span>Risk if left alone</span>
          <span>Returns from shoppers who bought it for heavy rain</span>
        </div>
      </section>

      <section className="card">
        <h2>The change</h2>
        <p className="muted">
          {weeklyFix.product} · {weeklyFix.field}
        </p>
        <div className="compare diff">
          <div className="said">
            <p className="lbl">Before</p>
            <p>
              <del>{weeklyFix.before}</del>
            </p>
          </div>
          <div className="truth">
            <p className="lbl">After</p>
            <p>
              <ins>{weeklyFix.after}</ins>
            </p>
          </div>
        </div>
        <FixActions holdouts={weeklyFix.holdouts} />
      </section>
    </div>
  );
}
