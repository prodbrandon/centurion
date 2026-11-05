"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";

export interface ChartData {
  kind: "bar" | "line";
  title: string;
  unit: "usd" | "count" | "percent";
  points: { label: string; value: number }[];
}

export const fmt = (v: number, unit: ChartData["unit"]) =>
  unit === "usd" ? `$${Math.round(v).toLocaleString("en-US")}` : unit === "percent" ? `${v}%` : Math.round(v).toLocaleString("en-US");

const EASE = [0.22, 1, 0.36, 1] as const;

/** Small, honest charts for chat answers: values come from the store data, drawn in SVG, animated in. */
export function Chart({ data }: { data: ChartData }) {
  const reduce = useReducedMotion();
  const max = Math.max(...data.points.map(p => p.value), 1);
  return (
    <figure className="chat-chart">
      <figcaption>{data.title}</figcaption>
      {data.kind === "bar" ? (
        <div className="cbars" role="list">
          {data.points.map((p, i) => (
            <div key={p.label} className="cbar" role="listitem" aria-label={`${p.label}: ${fmt(p.value, data.unit)}`}>
              <span className="cbar-label">{p.label}</span>
              <span className="cbar-value">{fmt(p.value, data.unit)}</span>
              <span className="cbar-track">
                <motion.span
                  className="cbar-fill"
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${Math.max((p.value / max) * 100, 1.5)}%` }}
                  transition={{ duration: 0.6, delay: i * 0.05, ease: EASE }}
                />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Line data={data} max={max} reduce={Boolean(reduce)} />
      )}
    </figure>
  );
}

function Line({ data, max, reduce }: { data: ChartData; max: number; reduce: boolean }) {
  const clip = `clip${useId().replace(/:/g, "")}`;
  const W = 320;
  const H = 110;
  const pad = 4;
  const n = data.points.length;
  const x = (i: number) => pad + (n === 1 ? 0 : (i / (n - 1)) * (W - pad * 2));
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const d = data.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const peak = data.points.reduce((a, b) => (b.value > a.value ? b : a), data.points[0]!);
  const first = data.points[0]!;
  const last = data.points.at(-1)!;
  return (
    <div className="cline">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${data.title}: from ${fmt(first.value, data.unit)} to ${fmt(last.value, data.unit)}, peak ${fmt(peak.value, data.unit)} (${peak.label})`}
      >
        <defs>
          <clipPath id={clip}>
            <motion.rect x="0" y="0" height={H} initial={reduce ? false : { width: 0 }} animate={{ width: W }} transition={{ duration: 0.9, ease: EASE }} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          <path d={`${d} L${x(n - 1)},${H} L${x(0)},${H} Z`} className="cline-area" />
          <path d={d} className="cline-path" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <div className="cline-axis">
        <span>{first.label}</span>
        <span>
          Peak {fmt(peak.value, data.unit)} · {peak.label}
        </span>
        <span>{last.label}</span>
      </div>
    </div>
  );
}
