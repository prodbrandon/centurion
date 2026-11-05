"use client";

import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import type { AiSalesView } from "@centurion/core";

type Order = AiSalesView["aiOrders"][number];
type Metric = "revenue" | "orders" | "share";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const num = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "0%");
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const JOURNEY: Record<string, string> = { both: "AI at first & last visit", first: "Found via AI, bought later", last: "Came back via AI to buy", checkout: "Bought inside an AI channel" };
const PROOF: Record<string, string> = { utm: "UTM tag from the AI", referrer: "AI referrer URL", checkout_in_ai: "AI checkout channel" };
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Explore AI revenue: every number is computed from the attributed AI orders in the report. Click an assistant,
 * a week or a product to filter everything; click again to clear. Product rows rank by units and orders, since
 * line items carry no prices; revenue is always whole-order revenue.
 */
export function SalesExplorer({ view }: { view: AiSalesView }) {
  const reduce = useReducedMotion();
  const r = view.report;
  const [source, setSource] = useState<string | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("revenue");
  const [shown, setShown] = useState(12);

  const weeks = r.weekly.map(w => w.week_start);
  const weekOf = (iso: string) => {
    let w = weeks[0]!;
    for (const s of weeks) if (iso.slice(0, 10) >= s) w = s;
    return w;
  };

  const match = (o: Order, skip?: "source" | "week" | "product") =>
    (skip === "source" || !source || o.source === source) &&
    (skip === "week" || !week || weekOf(o.createdAt) === week) &&
    (skip === "product" || !product || o.items.some(i => i.title === product));

  const orders = useMemo(() => view.aiOrders.filter(o => match(o)), [view, source, week, product]);
  const revenue = orders.reduce((t, o) => t + o.total, 0);
  const filtered = Boolean(source || week || product);

  // Each panel ignores its own filter, so you can see the alternatives you could switch to.
  const bySource = useMemo(() => group(view.aiOrders.filter(o => match(o, "source")), o => o.source), [view, week, product]);
  const byWeek = useMemo(() => {
    const g = group(view.aiOrders.filter(o => match(o, "week")), o => weekOf(o.createdAt));
    return r.weekly.map(w => ({ key: w.week_start, orders: g.get(w.week_start)?.orders ?? 0, revenue: g.get(w.week_start)?.revenue ?? 0, total: w.total_revenue }));
  }, [view, source, product]);
  const byProduct = useMemo(() => {
    const m = new Map<string, { units: number; orders: number }>();
    for (const o of view.aiOrders.filter(x => match(x, "product")))
      for (const i of o.items) {
        const e = m.get(i.title) ?? { units: 0, orders: 0 };
        e.units += i.quantity;
        e.orders += 1;
        m.set(i.title, e);
      }
    return [...m].sort((a, b) => b[1].units - a[1].units).slice(0, 10);
  }, [view, source, week]);
  const journeys = group(orders, o => o.touch ?? "unknown");
  const proofs = group(orders, o => o.evidence ?? "unknown");

  const trendValue = (w: (typeof byWeek)[number]) => (metric === "revenue" ? w.revenue : metric === "orders" ? w.orders : w.total ? (w.revenue / w.total) * 100 : 0);
  const trendMax = Math.max(...byWeek.map(trendValue), 1);
  const trendLabel = (v: number) => (metric === "revenue" ? usd(v) : metric === "orders" ? num(v) : `${v.toFixed(1)}%`);
  const srcMax = Math.max(...[...bySource.values()].map(s => s.revenue), 1);
  const prodMax = Math.max(...byProduct.map(([, p]) => p.units), 1);
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 380, damping: 32 };

  return (
    <LayoutGroup>
      <div className="stack explorer">
        <div className="filterbar" aria-live="polite">
          <span className="muted">Showing</span>
          <AnimatePresence initial={false}>
            {!filtered ? (
              <motion.span key="all" className="fchip static" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                All {num(view.aiOrders.length)} AI orders
              </motion.span>
            ) : null}
            {[
              source && { k: "s", label: source, clear: () => setSource(null) },
              week && { k: "w", label: `Week of ${day(week)}`, clear: () => setWeek(null) },
              product && { k: "p", label: product, clear: () => setProduct(null) }
            ]
              .filter(Boolean)
              .map(f => {
                const c = f as { k: string; label: string; clear: () => void };
                return (
                  <motion.button
                    layout={!reduce}
                    key={c.k}
                    type="button"
                    className="fchip"
                    onClick={c.clear}
                    initial={reduce ? false : { opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduce ? undefined : { opacity: 0, scale: 0.9 }}
                    aria-label={`Remove filter ${c.label}`}
                  >
                    {c.label} <span aria-hidden="true">×</span>
                  </motion.button>
                );
              })}
          </AnimatePresence>
          {filtered ? (
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setSource(null);
                setWeek(null);
                setProduct(null);
              }}
            >
              Clear all
            </button>
          ) : (
            <span className="muted">· click any assistant, week or product to drill in</span>
          )}
        </div>

        <motion.div layout={!reduce} className="kpis">
          <Kpi label="AI revenue" value={usd(revenue)} sub={filtered ? `${pct(revenue, r.ai.revenue)} of all AI revenue` : `${r.ai.share_of_revenue}% of store revenue`} />
          <Kpi label="AI orders" value={num(orders.length)} sub={filtered ? `${pct(orders.length, r.ai.orders)} of AI orders` : `of ${num(r.orders)} orders`} />
          <Kpi label="Average AI order" value={usd(orders.length ? revenue / orders.length : 0)} sub={`vs ${usd(r.ai.non_ai_avg_order_value)} non-AI`} />
          <Kpi label="Proven by UTM or checkout" value={pct((proofs.get("utm")?.orders ?? 0) + (proofs.get("checkout_in_ai")?.orders ?? 0), orders.length)} sub="strongest proof types" />
        </motion.div>

        <section className="card">
          <div className="card-head">
            <h2>AI revenue trajectory</h2>
            <div className="seg" role="tablist" aria-label="Trend metric">
              {(["revenue", "orders", "share"] as Metric[]).map(m => (
                <button key={m} type="button" role="tab" aria-selected={metric === m} className={metric === m ? "on" : ""} onClick={() => setMetric(m)} disabled={m === "share" && filtered}>
                  <span>{m === "revenue" ? "Revenue" : m === "orders" ? "Orders" : "AI share"}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="tcols" role="list">
            {byWeek.map((w, i) => {
              const v = trendValue(w);
              const on = week === w.key;
              return (
                <button
                  key={w.key}
                  type="button"
                  role="listitem"
                  className={`tcol${on ? " on" : ""}${week && !on ? " dim" : ""}`}
                  onClick={() => setWeek(on ? null : w.key)}
                  aria-label={`Week of ${day(w.key)}: ${trendLabel(v)}${on ? ", selected" : ""}`}
                  aria-pressed={on}
                >
                  <span className="tcol-tip">
                    <b>{trendLabel(v)}</b>
                    <span>
                      Week of {day(w.key)} · {num(w.orders)} orders
                    </span>
                  </span>
                  <motion.span className="tcol-fill" initial={reduce ? false : { height: 0 }} animate={{ height: `${Math.max((v / trendMax) * 100, 1)}%` }} transition={{ duration: 0.5, delay: reduce ? 0 : i * 0.02, ease: EASE }} />
                </button>
              );
            })}
          </div>
          <div className="cols-axis">
            <span>{day(byWeek[0]!.key)}</span>
            <span>
              Peak {trendLabel(Math.max(...byWeek.map(trendValue)))} · first and last weeks are partial
            </span>
            <span>{day(byWeek.at(-1)!.key)}</span>
          </div>
        </section>

        <div className="grid-2">
          <section className="card">
            <h2>Demand by AI agent</h2>
            <p className="sub card-sub">Revenue, orders and how each agent’s shoppers bought. Click to filter.</p>
            <div className="hbars">
              {[...bySource].sort((a, b) => b[1].revenue - a[1].revenue).map(([s, v]) => {
                const on = source === s;
                const mix = group(v.list, o => o.touch ?? "unknown");
                return (
                  <button key={s} type="button" className={`hbar-row pick${on ? " on" : ""}${source && !on ? " dim" : ""}`} onClick={() => setSource(on ? null : s)} aria-pressed={on}>
                    <span className="hbar-label">{s}</span>
                    <span className="hbar-value">
                      {usd(v.revenue)} · {num(v.orders)} orders · {usd(v.revenue / v.orders)} avg
                    </span>
                    <span className="hbar-track">
                      <motion.span className="hbar-fill" layout={!reduce} initial={false} animate={{ width: `${Math.max((v.revenue / srcMax) * 100, 1.5)}%` }} transition={spring} />
                    </span>
                    <span className="mix" aria-label={`Journeys: ${[...mix].map(([k, m]) => `${JOURNEY[k] ?? k} ${m.orders}`).join(", ")}`}>
                      {["both", "first", "last", "checkout"].map(k => (
                        <span key={k} className={`mix-${k}`} style={{ width: `${((mix.get(k)?.orders ?? 0) / v.orders) * 100}%` }} title={`${JOURNEY[k]}: ${mix.get(k)?.orders ?? 0}`} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            <Legend />
          </section>

          <section className="card">
            <h2>Agent-assisted journeys</h2>
            <p className="sub card-sub">How {source ?? "AI"} shoppers bought{week ? ` in the week of ${day(week)}` : ""}{product ? `, orders with ${product}` : ""}.</p>
            <Dist rows={["both", "first", "last", "checkout"].map(k => ({ label: JOURNEY[k]!, orders: journeys.get(k)?.orders ?? 0, revenue: journeys.get(k)?.revenue ?? 0, cls: `mix-${k}` }))} total={orders.length} />
            <h3 className="mini-h">Proof behind each order</h3>
            <Dist rows={["utm", "referrer", "checkout_in_ai"].map(k => ({ label: PROOF[k]!, orders: proofs.get(k)?.orders ?? 0, revenue: proofs.get(k)?.revenue ?? 0 }))} total={orders.length} />
          </section>
        </div>

        <section className="card">
          <h2>Products agents recommend most</h2>
          <p className="sub card-sub">Units in AI orders{filtered ? " matching your filters" : ""}. Click a product to see its orders. Ranked by units because order lines carry no prices.</p>
          <div className="hbars">
            {byProduct.map(([title, p]) => {
              const on = product === title;
              return (
                <button key={title} type="button" className={`hbar-row pick${on ? " on" : ""}${product && !on ? " dim" : ""}`} onClick={() => setProduct(on ? null : title)} aria-pressed={on}>
                  <span className="hbar-label">{title}</span>
                  <span className="hbar-value">
                    {num(p.units)} units · in {num(p.orders)} orders
                  </span>
                  <span className="hbar-track">
                    <motion.span className="hbar-fill" layout={!reduce} initial={false} animate={{ width: `${Math.max((p.units / prodMax) * 100, 1.5)}%` }} transition={spring} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Attribution ledger</h2>
            <span className="muted">
              {num(orders.length)} orders · {usd(revenue)}
            </span>
          </div>
          <p className="sub card-sub">Every order we counted as AI, with the exact signal that proves it. Check any of them in Shopify.</p>
          <AnimatePresence initial={false}>
            {orders.slice(0, shown).map(o => (
              <motion.details key={o.name} className="order" layout={!reduce} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }}>
                <summary>
                  <span className="o-name">{o.name}</span>
                  <span className="o-src">
                    {o.source} · {day(o.createdAt)} · {JOURNEY[o.touch ?? ""] ?? o.touch}
                  </span>
                  <span className="num">{usd(o.total)}</span>
                </summary>
                <div className="proof">
                  <b>{PROOF[o.evidence ?? ""] ?? o.evidence}</b>
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
              </motion.details>
            ))}
          </AnimatePresence>
          {orders.length > shown ? (
            <button type="button" className="btn secondary" style={{ marginTop: 12 }} onClick={() => setShown(s => s + 25)}>
              Show 25 more of {num(orders.length - shown)}
            </button>
          ) : null}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Unattributed signal</h2>
            <span className="tag">Not counted as AI revenue</span>
          </div>
          <p className="sub card-sub">
            Orders whose first visit landed directly on a product page with no referrer. AI links often arrive this way when the referrer is
            stripped, but there is no proof, so Centurion reports them separately and never adds them to AI revenue.
          </p>
          <div className="kpis">
            <Kpi label="Unproven orders" value={num(view.candidates.orders)} sub={`${pct(view.candidates.orders, r.orders)} of all orders`} />
            <Kpi label="Their revenue" value={usd(view.candidates.revenue)} sub={`${pct(view.candidates.revenue, r.revenue)} of store revenue`} />
            <Kpi label="Average order" value={usd(view.candidates.orders ? view.candidates.revenue / view.candidates.orders : 0)} sub={`vs ${usd(r.ai.avg_order_value)} proven AI`} />
            <Kpi label="Size vs proven AI" value={`${(view.candidates.revenue / r.ai.revenue).toFixed(2)}×`} sub="unproven ÷ proven AI revenue" />
          </div>
          <div className="range" aria-label={`Proven AI revenue ${usd(r.ai.revenue)}; if every unproven order were AI, up to ${usd(r.ai.revenue + view.candidates.revenue)}`}>
            <div className="range-bar">
              <motion.span className="range-proven" initial={reduce ? false : { width: 0 }} whileInView={{ width: `${(r.ai.revenue / (r.ai.revenue + view.candidates.revenue)) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.6, ease: EASE }} />
              <span className="range-possible" />
            </div>
            <div className="range-legend">
              <span>
                <i className="range-proven" /> Proven AI revenue <b>{usd(r.ai.revenue)}</b>
              </span>
              <span>
                <i className="range-possible" /> Ceiling if every unproven order were AI <b>{usd(r.ai.revenue + view.candidates.revenue)}</b>
              </span>
            </div>
          </div>
          <h3 className="mini-h">Sample unproven orders</h3>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Landed on</th>
                <th className="r">Total</th>
              </tr>
            </thead>
            <tbody>
              {view.candidates.examples.map(e => (
                <tr key={e.name}>
                  <td className="mono">{e.name}</td>
                  <td>
                    <code>{e.proof[0]?.match(/\/products\/[\w-]+/)?.[0] ?? e.proof[0]}</code>
                  </td>
                  <td className="r num">{usd(e.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 10 }}>
            To turn these into proven AI revenue, add utm_source tags to links you give AI assistants and product feeds.
          </p>
        </section>
      </div>
    </LayoutGroup>
  );
}

function group(orders: Order[], key: (o: Order) => string) {
  const m = new Map<string, { orders: number; revenue: number; list: Order[] }>();
  for (const o of orders) {
    const e = m.get(key(o)) ?? { orders: 0, revenue: 0, list: [] };
    e.orders += 1;
    e.revenue += o.total;
    e.list.push(o);
    m.set(key(o), e);
  }
  return m;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <motion.b key={value} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        {value}
      </motion.b>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}

function Dist({ rows, total }: { rows: { label: string; orders: number; revenue: number; cls?: string }[]; total: number }) {
  return (
    <div className="dist">
      {rows.map(r => (
        <div key={r.label} className="dist-row">
          <span className={`dist-dot ${r.cls ?? ""}`} />
          <span className="dist-label">{r.label}</span>
          <span className="dist-val">
            {pct(r.orders, total)} · {r.orders.toLocaleString("en-US")} · {usd(r.revenue)}
          </span>
          <span className="dist-track">
            <motion.span className={`dist-fill ${r.cls ?? ""}`} initial={false} animate={{ width: `${total ? (r.orders / total) * 100 : 0}%` }} transition={{ duration: 0.4, ease: EASE }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <p className="legend">
      {Object.entries(JOURNEY).map(([k, v]) => (
        <span key={k}>
          <i className={`mix-${k}`} /> {v}
        </span>
      ))}
    </p>
  );
}
