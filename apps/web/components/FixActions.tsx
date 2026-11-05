"use client";

import { useState } from "react";

/** Apply and undo on a copy of the demo product's description, in the browser. Nothing is sent anywhere. */
export function FixActions({ before, addition, holdouts }: { before: string; addition: string; holdouts: string[] }) {
  const [applied, setApplied] = useState<string | null>(null);

  return (
    <>
      <div className="compare diff">
        <div className="said">
          <p className="lbl">{applied ? "Was" : "Now"}</p>
          <p>{before}</p>
        </div>
        <div className="truth">
          <p className="lbl">{applied ? "Live (demo copy)" : "After"}</p>
          <p>
            <ins>{addition}</ins> {before}
          </p>
        </div>
      </div>
      {applied ? (
        <div>
          <p className="status ok" style={{ marginTop: 16 }}>
            <span aria-hidden="true">✓</span> Applied {applied}
          </p>
          <p className="sub" style={{ marginTop: 4 }}>
            Next week we compare AI revenue for this product with products held back ({holdouts.join(", ")}), so you see the real effect,
            not a guess.
          </p>
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setApplied(null)}>
              Undo
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row">
          <button
            className="btn"
            onClick={() => setApplied(new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}
          >
            Apply this fix
          </button>
          <span className="muted" style={{ alignSelf: "center" }}>
            Demo only. Nothing changes on a real store.
          </span>
        </div>
      )}
    </>
  );
}
