import { EVIDENCE_WORDS, getAiSales, money, shortDate, TOUCH_WORDS, type AiOrder } from "@/lib/data";

const listWords = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

function OrderRow({ o }: { o: AiOrder }) {
  return (
    <details className="order">
      <summary>
        <span className="o-name">{o.name}</span>
        <span className="o-src">
          {o.source} · {shortDate(o.createdAt)}
        </span>
        <span className="num">{money(o.total)}</span>
      </summary>
      <div className="proof">
        <b>{EVIDENCE_WORDS[o.evidence ?? ""] ?? o.evidence}</b> · {TOUCH_WORDS[o.touch ?? ""] ?? o.touch}
        <ul>
          {o.proof.map(p => (
            <li key={p}>
              <code>{p}</code>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ marginTop: 8 }}>
          Bought: {o.items.map(i => `${i.quantity} × ${i.title}`).join(", ")}
        </p>
      </div>
    </details>
  );
}

export default async function AiSalesPage() {
  const sales = await getAiSales();
  const data = sales.view;
  if (!data) {
    return (
      <section className="card">
        <h2>No report yet</h2>
        <p className="sub">
          Open Centurion in the Shopify admin for {sales.mode === "live" ? sales.shop : "this store"} and run the first report. It
          shows up here as soon as it finishes.
        </p>
      </section>
    );
  }
  const r = data.report;
  if (r.orders === 0) {
    return (
      <section className="card">
        <h2>No orders in this period</h2>
        <p className="sub">The last report found no orders. Once the store has orders, run the report again in the Shopify admin.</p>
      </section>
    );
  }
  const maxSource = Math.max(...r.by_source.map(s => s.revenue));
  const maxWeek = Math.max(...r.weekly.map(w => w.ai_revenue));
  const first = data.aiOrders.slice(0, 8);
  const rest = data.aiOrders.slice(8);

  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">
          AI Sales · {shortDate(r.period.from)} to {shortDate(r.period.to)}
        </p>
        <p className="hero-number num">{money(r.ai.revenue)}</p>
        <p>
          from {r.ai.orders} orders that {listWords(r.by_source.map(s => s.label)) || "AI assistants"} sent you. That’s{" "}
          {r.ai.share_of_revenue}% of revenue.
        </p>
        <div className="hero-stats">
          <div>
            <b className="num">{money(r.ai.avg_order_value)}</b>
            <span>average AI order</span>
          </div>
          <div>
            <b className="num">{money(r.ai.non_ai_avg_order_value)}</b>
            <span>average for everything else</span>
          </div>
          <div>
            <b className="num">{r.ai.orders}</b>
            <span>orders, each with proof below</span>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Which AI sent them</h2>
          <div className="hbars">
            {r.by_source.map(s => (
              <div className="hbar-row" key={s.source} title={`${s.label}: ${money(s.revenue)} from ${s.orders} orders`}>
                <span className="hbar-label">{s.label}</span>
                <span className="hbar-value num">
                  {money(s.revenue)} · {s.orders} orders
                </span>
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${(s.revenue / maxSource) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>AI revenue by week</h2>
          <div className="cols" role="img" aria-label={`Weekly AI revenue, from ${money(r.weekly[0].ai_revenue)} to ${money(r.weekly.at(-1)!.ai_revenue)}`}>
            {r.weekly.map(w => (
              <div className="col" key={w.week_start} tabIndex={0}>
                <div className="col-fill" style={{ height: `${(w.ai_revenue / maxWeek) * 100}%` }} />
                <span className="col-tip">
                  Week of {shortDate(w.week_start)}: {money(w.ai_revenue)} of {money(w.total_revenue)}
                </span>
              </div>
            ))}
          </div>
          <div className="cols-axis">
            <span>{shortDate(r.weekly[0].week_start)}</span>
            <span>Peak week {money(maxWeek)}</span>
            <span>{shortDate(r.weekly.at(-1)!.week_start)}</span>
          </div>
          <details className="more">
            <summary>Show as table</summary>
            <table>
              <thead>
                <tr>
                  <th>Week of</th>
                  <th className="r">AI revenue</th>
                  <th className="r">All revenue</th>
                </tr>
              </thead>
              <tbody>
                {r.weekly.map(w => (
                  <tr key={w.week_start}>
                    <td>{shortDate(w.week_start)}</td>
                    <td className="r num">{money(w.ai_revenue)}</td>
                    <td className="r num">{money(w.total_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>How shoppers used AI</h2>
          {r.by_touch.map(t => (
            <div className="kv" key={t.touch}>
              <span>{TOUCH_WORDS[t.touch] ?? t.touch}</span>
              <span className="num">
                {t.orders} · {money(t.revenue)}
              </span>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Products AI sells most</h2>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="r">Units</th>
                <th className="r">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {r.top_products.slice(0, 5).map(p => (
                <tr key={p.title}>
                  <td>{p.title}</td>
                  <td className="r num">{p.units}</td>
                  <td className="r num">{money(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card">
        <h2>Every AI order, with proof</h2>
        <p className="sub" style={{ marginBottom: 8 }}>
          Tap an order to see exactly why we counted it. You can check each one in Shopify.{" "}
          {r.by_evidence.map(e => `${EVIDENCE_WORDS[e.evidence] ?? e.evidence}: ${e.orders}`).join(" · ")}.
        </p>
        {first.map(o => (
          <OrderRow key={o.name} o={o} />
        ))}
        <details className="more">
          <summary>Show all {data.aiOrders.length} AI orders</summary>
          {rest.map(o => (
            <OrderRow key={o.name} o={o} />
          ))}
        </details>
      </section>

      <section className="card">
        <h2>Not counted, but worth watching</h2>
        <p className="sub">
          {data.candidates.orders} orders ({money(data.candidates.revenue)}) came in “direct” straight to a product page. AI links
          often look like this when the referrer is stripped, but we can’t prove it, so we never count them as AI sales.
        </p>
      </section>
    </div>
  );
}
