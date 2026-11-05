"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CheckoutRunResult } from "@centurion/core";
import { AgentReplay } from "../AgentReplay";
import { Chart, type ChartData } from "./Chart";

export interface Reply {
  headline: string;
  metrics: { label: string; value: string }[];
  bullets: string[];
  chart: ChartData | null;
  table: { columns: string[]; rows: string[][] } | null;
  actions: { id: string; label: string }[];
}

export type Card =
  | {
      type: "fix";
      product: string;
      addition: string;
      before: string;
      aiRevenue: number;
      periodDays: number;
      finding: { provider: string; said: string; truth: string } | null;
      holdouts: string[];
      /** True when Apply writes to the real (dev) store; false applies to a demo copy in the browser. */
      live: boolean;
      shop: string | null;
    }
  | { type: "answer_check"; asked: number; matched: number; wrong: number; noAnswer: number; fixture: boolean; top: { product: string; assistant: string; said: string; truth: string }[] }
  | { type: "checkout"; run: CheckoutRunResult }
  | { type: "csv"; filename: string; rows: number; csv: string }
  | { type: "navigate"; href: string; label: string }
  | { type: "note"; text: string };

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** A structured answer: headline, key numbers, chart, table, bullets and next-step action buttons. */
export function ReplyView({ reply, onAction, busy }: { reply: Reply; onAction: (id: string) => void; busy: boolean }) {
  const reduce = useReducedMotion();
  const item = (i: number) => (reduce ? {} : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, delay: 0.06 * i } });
  return (
    <div className="reply">
      <motion.p className="reply-head" {...item(0)}>
        {reply.headline}
      </motion.p>
      {reply.metrics.length > 0 ? (
        <motion.div className="metrics" {...item(1)}>
          {reply.metrics.map(m => (
            <div key={m.label} className="metric">
              <b>{m.value}</b>
              <span>{m.label}</span>
            </div>
          ))}
        </motion.div>
      ) : null}
      {reply.chart ? (
        <motion.div {...item(2)}>
          <Chart data={reply.chart} />
        </motion.div>
      ) : null}
      {reply.table ? (
        <motion.div className="reply-table" {...item(3)}>
          <table>
            <thead>
              <tr>
                {reply.table.columns.map(c => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reply.table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      ) : null}
      {reply.bullets.length > 0 ? (
        <motion.ul className="reply-bullets" {...item(4)}>
          {reply.bullets.map(b => (
            <li key={b}>{b}</li>
          ))}
        </motion.ul>
      ) : null}
      {reply.actions.length > 0 ? (
        <motion.div className="reply-actions" {...item(5)}>
          {reply.actions.map((a, i) => (
            <button key={a.id} type="button" className={`act${i === 0 ? " primary" : ""}`} onClick={() => onAction(a.id)} disabled={busy}>
              {a.label} <span aria-hidden="true">→</span>
            </button>
          ))}
        </motion.div>
      ) : null}
    </div>
  );
}

/** The result of an action run from the chat. */
export function CardView({ card }: { card: Card }) {
  switch (card.type) {
    case "fix":
      return <FixCard card={card} />;
    case "answer_check":
      return (
        <div className="card-x">
          <p className="card-x-title">
            Answer Check · {card.asked} questions{card.fixture ? " · sample answers" : ""}
          </p>
          <div className="metrics">
            <div className="metric">
              <b className="good">{card.matched}</b>
              <span>Matched catalog</span>
            </div>
            <div className="metric">
              <b className="badn">{card.wrong}</b>
              <span>Wrong</span>
            </div>
            <div className="metric">
              <b>{card.noAnswer}</b>
              <span>No answer</span>
            </div>
          </div>
          <ul className="wrong-list">
            {card.top.map(t => (
              <li key={t.product + t.said}>
                <b>{t.product}</b> <span className="muted">· {t.assistant}</span>
                <p>
                  <del>{t.said}</del> → {t.truth}
                </p>
              </li>
            ))}
          </ul>
        </div>
      );
    case "checkout":
      return (
        <div className="card-x">
          <p className="card-x-title">AI agent checkout · replay</p>
          <AgentReplay run={card.run} compact />
        </div>
      );
    case "csv":
      return <CsvCard card={card} />;
    case "navigate":
      return <NavigateCard card={card} />;
    default:
      return <p className="card-x">{card.text}</p>;
  }
}

type Applied = { live: false } | { live: true; shop: string; productId: string; adminUrl: string; createdProduct: boolean; beforeHtml: string; afterHtml: string };

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "The action failed.");
  return data;
}

export function FixCard({ card }: { card: Extract<Card, { type: "fix" }> }) {
  const [applied, setApplied] = useState<Applied | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();

  async function apply() {
    setWorking(true);
    setError(null);
    try {
      setApplied((await post({ id: "apply_fix" })) as Applied);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }
  async function undo() {
    if (!applied) return;
    setWorking(true);
    setError(null);
    try {
      if (applied.live) await post({ id: "undo_fix", productId: applied.productId, beforeHtml: applied.beforeHtml, afterHtml: applied.afterHtml });
      setApplied(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card-x">
      <p className="card-x-title">
        This week’s fix · {card.product}
        <span className={`pill${card.live ? " live" : ""}`}>{card.live ? `Live · ${card.shop}` : "Demo copy"}</span>
      </p>
      <p className="fix-why">
        {usd(card.aiRevenue)} of AI sales in {card.periodDays} days
        {card.finding ? (
          <>
            , but {card.finding.provider} said “{card.finding.said}”. Your catalog says {card.finding.truth}.
          </>
        ) : (
          "."
        )}
      </p>
      <div className="fix-desc">
        <AnimatePresence initial={false}>
          {applied ? (
            <motion.p
              key="add"
              className="fix-add"
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduce ? undefined : { opacity: 0, height: 0 }}
            >
              {card.addition}
            </motion.p>
          ) : (
            <motion.p key="proposed" className="fix-proposed" initial={false} exit={reduce ? undefined : { opacity: 0 }}>
              + {card.addition}
            </motion.p>
          )}
        </AnimatePresence>
        <p className="fix-before">{card.before}</p>
      </div>
      {!applied ? (
        <div className="reply-actions">
          <button type="button" className="act primary" onClick={() => void apply()} disabled={working}>
            {working ? "Applying…" : card.live ? `Apply to ${card.product} in Shopify` : "Apply to product description"}
          </button>
        </div>
      ) : (
        <motion.div className="fix-done" initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          {applied.live ? (
            <>
              <span className="status ok">
                ✓ Live on {applied.shop}
                {applied.createdProduct ? " (demo product created)" : ""}
              </span>
              <a className="act" href={applied.adminUrl} target="_blank" rel="noreferrer">
                View in Shopify admin ↗
              </a>
            </>
          ) : (
            <span className="status ok">✓ Applied (demo copy)</span>
          )}
          <span className="muted">Measured next week against {card.holdouts.join(" and ")}.</span>
          <button type="button" className="act" onClick={() => void undo()} disabled={working}>
            {working ? "Undoing…" : "Undo"}
          </button>
        </motion.div>
      )}
      {error ? <p className="assistant-error">{error}</p> : null}
    </div>
  );
}

function CsvCard({ card }: { card: Extract<Card, { type: "csv" }> }) {
  const done = useRef(false);
  const download = () => {
    const url = URL.createObjectURL(new Blob([card.csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = card.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    download();
  });
  return (
    <div className="card-x row">
      <span className="status ok">✓ Exported {card.rows.toLocaleString("en-US")} AI orders</span>
      <button type="button" className="act" onClick={download}>
        Download {card.filename}
      </button>
    </div>
  );
}

function NavigateCard({ card }: { card: Extract<Card, { type: "navigate" }> }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    router.push(card.href);
  });
  return <p className="card-x muted">Opened {card.label.replace(/^Open /, "")}. The conversation stays here.</p>;
}
