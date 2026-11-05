"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import type { CheckoutRunResult, CheckoutStep } from "@centurion/core";

type Scene = "home" | "search" | "product" | "options" | "added" | "cart" | "checkout";

/** Which storefront view a recorded step shows, from the step's own title. */
function sceneFor(step: CheckoutStep): Scene {
  const t = step.title.toLowerCase();
  if (t.includes("search")) return "search";
  if (t.includes("product page")) return "product";
  if (t.includes("option")) return "options";
  if (t.includes("add to cart")) return "added";
  if (t.includes("cart")) return "cart";
  if (t.includes("checkout")) return "checkout";
  return "home";
}

const MARK = { passed: "✓", slowed: "!", blocked: "✕" } as const;

/**
 * Replays a recorded checkout run as an animated storefront plus the agent's step log. The steps, statuses,
 * details and hints are the run's own; the storefront drawing is an illustration of each step.
 */
export function AgentReplay({ run, compact = false, autoPlay = true }: { run: CheckoutRunResult; compact?: boolean; autoPlay?: boolean }) {
  const reduce = useReducedMotion();
  const [at, setAt] = useState(autoPlay ? 0 : run.steps.length - 1);
  const [playing, setPlaying] = useState(autoPlay && !reduce);
  const step = run.steps[at]!;
  const scene = sceneFor(step);
  const product = run.query ? run.query.replace(/\b\w/g, c => c.toUpperCase()) : "Product";
  const done = at >= run.steps.length - 1;

  useEffect(() => {
    if (!playing || done) {
      if (done) setPlaying(false);
      return;
    }
    // Slowed steps hold a little longer so the problem can be read.
    const t = setTimeout(() => setAt(a => a + 1), step.status === "passed" ? 1300 : 2600);
    return () => clearTimeout(t);
  }, [playing, at, done, step.status]);

  const replay = () => {
    setAt(0);
    setPlaying(true);
  };

  return (
    <div className={`replay${compact ? " compact" : ""}`}>
      <div className="replay-stage" aria-hidden="true">
        <div className="shop-bar">
          <span className="shop-dot" />
          <span className="shop-dot" />
          <span className="shop-dot" />
          <span className="shop-url">{new URL(step.url).pathname + new URL(step.url).search}</span>
        </div>
        <div className="shop-body">
          <AnimatePresence mode="wait">
            <motion.div
              key={scene}
              className="shop-scene"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {scene === "home" ? (
                <>
                  <div className="shop-hero">Test store</div>
                  <div className="shop-grid">
                    <span />
                    <span />
                    <span />
                  </div>
                </>
              ) : scene === "search" ? (
                <>
                  <div className="shop-search">
                    <Typed text={run.query ?? "search"} />
                  </div>
                  <div className="shop-result hit">{product}</div>
                  <div className="shop-result" />
                </>
              ) : scene === "product" || scene === "options" || scene === "added" ? (
                <div className="shop-product">
                  <div className="shop-img" />
                  <div className="shop-info">
                    <b>{product}</b>
                    <span>$229.00</span>
                    <div className={`shop-sizes${scene === "options" ? " warn" : ""}`}>
                      {["S", "M", "L"].map(s => (
                        <span key={s} className={scene !== "product" && s === "M" ? "on" : ""}>
                          {s}
                        </span>
                      ))}
                      {scene === "options" ? <em>no label</em> : null}
                    </div>
                    <span className={`shop-btn${scene === "added" ? " ok" : ""}`}>{scene === "added" ? "✓ Added to cart" : "Add to cart"}</span>
                  </div>
                </div>
              ) : scene === "cart" ? (
                <div className="shop-cart">
                  <div className="shop-line">
                    {product} · M <span>$229.00</span>
                  </div>
                  <span className="shop-btn">Checkout</span>
                  <motion.div
                    className="shop-popup"
                    initial={{ opacity: 1, scale: 1 }}
                    animate={reduce ? { opacity: 0 } : { opacity: [1, 1, 0], scale: [1, 1, 0.92] }}
                    transition={{ duration: 2, times: [0, 0.7, 1] }}
                  >
                    Get 10% off! <span>×</span>
                  </motion.div>
                </div>
              ) : (
                <div className="shop-checkout">
                  <div className="shop-field">Email</div>
                  <div className="shop-field">Shipping address</div>
                  <div className="shop-guard">Agent stops here: payment is never submitted</div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <ol className="replay-log" aria-label="Agent steps">
        {run.steps.slice(0, at + 1).map(s => (
          <motion.li
            key={s.n}
            className={`rstep ${s.status}${s.n === step.n ? " now" : ""}`}
            initial={reduce ? false : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
          >
            <span className="rmark">{MARK[s.status]}</span>
            <div>
              <b>{s.title}</b>
              {!compact || s.status !== "passed" ? <p>{s.detail}</p> : null}
              {s.hint ? <p className="rhint">Fix: {s.hint}</p> : null}
            </div>
          </motion.li>
        ))}
        {done ? (
          <motion.li className="rstep result" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
            <span className="rmark">{run.result === "reached_checkout" ? "✓" : "✕"}</span>
            <div>
              <b>{run.result === "reached_checkout" ? "Reached checkout, stopped before payment" : `Blocked at step ${run.failedStep}`}</b>
              <p>
                {run.problems} {run.problems === 1 ? "step" : "steps"} slowed the agent. Fix {run.problems === 1 ? "it" : "them"} and more AI agents finish the purchase.
              </p>
            </div>
          </motion.li>
        ) : null}
      </ol>

      <div className="replay-controls">
        <span className="muted">
          Step {at + 1} of {run.steps.length} · recorded run on a test page
        </span>
        <button type="button" className="btn secondary" onClick={playing ? () => setPlaying(false) : done ? replay : () => setPlaying(true)}>
          {playing ? "Pause" : done ? "Replay" : "Play"}
        </button>
      </div>
    </div>
  );
}

function Typed({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const t = setInterval(() => setN(x => (x >= text.length ? x : x + 1)), 55);
    return () => clearInterval(t);
  }, [text]);
  return (
    <>
      {text.slice(0, n)}
      <span className="caret" />
    </>
  );
}
