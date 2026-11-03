"use client";

import { useState } from "react";

export function FixActions({ holdouts }: { holdouts: string[] }) {
  const [applied, setApplied] = useState<string | null>(null);

  if (applied) {
    return (
      <div>
        <p className="status ok" style={{ marginTop: 16 }}>
          <span aria-hidden="true">✓</span> Applied {applied}
        </p>
        <p className="sub" style={{ marginTop: 4 }}>
          Next week we compare AI orders for this product with products we held back ({holdouts.join(", ")}), so you see the real
          effect, not a guess.
        </p>
        <div className="btn-row">
          <button className="btn secondary" onClick={() => setApplied(null)}>
            Undo
          </button>
        </div>
      </div>
    );
  }

  return (
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
  );
}
