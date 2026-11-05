// Ask Centurion: a store analyst on Meta Muse Spark (Meta Model API). It answers merchants' questions from the
// store's own Centurion data only. The data goes into the prompt as a compact briefing, so every answer can be
// traced to a number on screen. Read-only: it never changes the store.
import type { AnswerCheckRun } from "./answer-check/types.ts";
import { META_DEFAULT_BASE_URL, META_DEFAULT_MODEL, ProviderError, readMetaAnswer, type ProviderEnv } from "./answer-check/providers.ts";
import type { AiSalesView } from "./types.ts";

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantContext {
  view: AiSalesView | null;
  answerCheck?: AnswerCheckRun | null;
  /** True when the data is the fictional demo store; the assistant says so when it matters. */
  demo: boolean;
  /** The Centurion screen the merchant is looking at, so "this page" questions make sense. */
  screen?: string;
}

const SCREEN_GUIDE: Record<string, string> = {
  "AI Sales": "AI-attributed revenue with proof: demand by AI agent, revenue trajectory by week, agent-assisted journeys, products agents recommend, the attribution ledger of every AI order and the unattributed signal",
  "Answer Check": "questions shoppers ask AI about the store, each AI answer compared with the catalog by fixed rules; wrong answers show what AI said vs the catalog fact and its source",
  "Checkout Test": "an AI shopping agent walks the store to checkout step by step (never pays) and reports where agents get stuck",
  "Weekly Fix": "one catalog fix a week: the top AI seller that AI gets wrong, the exact text to add, apply/undo, and a holdout comparison to measure the effect"
};

/** Muse Spark reasons before answering and reasoning counts toward the limit. */
export const ASSISTANT_MAX_COMPLETION_TOKENS = 4000;
/** Low reasoning keeps answers to a few seconds; override with META_REASONING_EFFORT (minimal, low, medium, high). */
export const ASSISTANT_REASONING_EFFORT = "low";
const ASSISTANT_TIMEOUT_MS = 60_000;
const MAX_HISTORY = 8;
const MAX_QUESTION = 1000;

export const ASSISTANT_SUGGESTIONS = [
  "Where is AI demand coming from, and what's growing fastest?",
  "Which products should I prioritize for AI shoppers this week?",
  "How confident are we in these numbers?",
  "What are AI assistants getting wrong about my products?"
];

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** "ChatGPT 2026-08 $4,100, 2026-09 $5,200; Perplexity ..." from the AI order list, for growth questions. */
function byAssistantByMonth(v: AiSalesView): string {
  const by = new Map<string, Map<string, number>>();
  for (const o of v.aiOrders) {
    const m = by.get(o.source) ?? new Map<string, number>();
    m.set(o.createdAt.slice(0, 7), (m.get(o.createdAt.slice(0, 7)) ?? 0) + o.total);
    by.set(o.source, m);
  }
  return [...by]
    .map(([source, months]) => `${source} ${[...months].sort(([a], [b]) => a.localeCompare(b)).map(([m, t]) => `${m} ${usd(t)}`).join(", ")}`)
    .join("; ");
}

/** A compact, plain-text briefing of the store's Centurion data for the model. */
export function storeBriefing(ctx: AssistantContext): string {
  const lines: string[] = [];
  if (ctx.screen && SCREEN_GUIDE[ctx.screen]) lines.push(`MERCHANT IS VIEWING: the ${ctx.screen} screen, which shows ${SCREEN_GUIDE[ctx.screen]}`);
  const v = ctx.view;
  if (!v) {
    lines.push("AI SALES: no report has run for this store yet.");
  } else {
    const r = v.report;
    lines.push(
      `STORE: ${v.store.name} (${v.store.domain})${ctx.demo ? " — fictional demo store with sample data" : ""}`,
      `PERIOD: ${r.period.from} to ${r.period.to}`,
      `ALL ORDERS: ${r.orders} orders, ${usd(r.revenue)} revenue`,
      `AI-ATTRIBUTED: ${r.ai.orders} orders, ${usd(r.ai.revenue)} (${r.ai.share_of_revenue}% of revenue); AI average order ${usd(r.ai.avg_order_value)} vs ${usd(r.ai.non_ai_avg_order_value)} non-AI`,
      `BY ASSISTANT: ${r.by_source.map(s => `${s.label} ${s.orders} orders / ${usd(s.revenue)}`).join("; ")}`,
      `BY JOURNEY (touch): ${r.by_touch.map(t => `${t.touch} ${t.orders} / ${usd(t.revenue)}`).join("; ")} (first = AI found them, bought later; last = came back via AI; both = AI at first and last visit; checkout = bought inside an AI channel)`,
      `BY EVIDENCE: ${r.by_evidence.map(e => `${e.evidence} ${e.orders} / ${usd(e.revenue)}`).join("; ")}`,
      `TOP AI PRODUCTS: ${r.top_products.slice(0, 15).map(p => `${p.title} ${p.units} units / ${usd(p.revenue)}`).join("; ")}`,
      `WEEKLY AI REVENUE (week start: AI / all): ${r.weekly.map(w => `${w.week_start}: ${usd(w.ai_revenue)} / ${usd(w.total_revenue)}`).join("; ")}`,
      `AI REVENUE BY ASSISTANT BY MONTH: ${byAssistantByMonth(v)}`,
      `NOT COUNTED (possible hidden AI): ${v.candidates.orders} direct-to-product-page orders, ${usd(v.candidates.revenue)}; never counted as AI because there is no proof`,
      `RECENT AI ORDERS (sample): ${v.aiOrders
        .slice(0, 12)
        .map(o => `${o.name} ${o.createdAt.slice(0, 10)} ${o.source} ${usd(o.total)} [${o.evidence}/${o.touch}]`)
        .join("; ")}`
    );
  }
  const ac = ctx.answerCheck;
  if (ac) {
    const wrong = ac.results.filter(x => x.status === "contradiction");
    lines.push(
      `ANSWER CHECK (${ac.mode === "live" ? "live model answers" : "written sample answers"}, ${ac.generatedAt.slice(0, 10)}): asked ${ac.asked}, matched ${ac.consistent}, wrong ${ac.contradictions}, no answer ${ac.noAnswer}, errors ${ac.errors}`,
      ...wrong.slice(0, 8).map(
        x => `WRONG ANSWER — ${x.subject} (${x.providerLabel}): ${x.issues.map(i => `said "${i.said}" but catalog says "${i.truth}" [${i.source}]`).join("; ")}`
      )
    );
  }
  return lines.join("\n");
}

export const ASSISTANT_SYSTEM_PROMPT =
  "You are Centurion, an AI commerce analyst inside a Shopify merchant's admin. You help the merchant understand and grow the sales that AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Meta AI) send their store. " +
  "Answer ONLY from the STORE DATA below. Quote the exact numbers you rely on. If the data does not answer the question, say what is missing and which Centurion screen or report would answer it; never invent numbers. " +
  "Be direct and brief: lead with the answer in one sentence, then at most 4 short bullets of evidence or next steps. Plain text, no tables, no headings, no quotation marks around numbers. Months at the edge of the period may be partial; say so when comparing them. " +
  "AI-attributed orders are only counted with proof (UTM tags, referrers, AI checkout channels); 'not counted' orders are possible but unproven. You cannot change the store; when an action would help, recommend it and name the screen (AI Sales, Answer Check, Checkout Test, Weekly Fix).";

/** Asks Meta Muse Spark one question about the store. Never logs or returns the key. */
export async function askAssistant(input: {
  question: string;
  history?: AssistantTurn[];
  context: AssistantContext;
  env?: ProviderEnv;
  fetch?: typeof fetch;
  /** Output instructions that replace the plain-text style (used by askAssistantRich for JSON). */
  format?: string;
}): Promise<{ answer: string; model: string }> {
  const env = input.env ?? process.env;
  const key = env.META_API_KEY?.trim();
  if (!key) throw new ProviderError("Set META_API_KEY to talk to Centurion's Meta Muse Spark assistant.");
  const question = input.question.trim().slice(0, MAX_QUESTION);
  if (!question) throw new ProviderError("Ask a question first.");
  const model = env.META_MODEL || META_DEFAULT_MODEL;
  const url = `${(env.META_API_BASE_URL || META_DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
  const history = (input.history ?? [])
    .filter(t => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-MAX_HISTORY)
    .map(t => ({ role: t.role, content: t.content.slice(0, 4000) }));

  let res: Response;
  try {
    res = await (input.fetch ?? globalThis.fetch)(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: `${ASSISTANT_SYSTEM_PROMPT}${input.format ? `\n\nOUTPUT FORMAT (overrides the style above)\n${input.format}` : ""}\n\nSTORE DATA\n${storeBriefing(input.context)}` },
          ...history,
          { role: "user", content: question }
        ],
        max_completion_tokens: ASSISTANT_MAX_COMPLETION_TOKENS,
        reasoning_effort: env.META_REASONING_EFFORT || ASSISTANT_REASONING_EFFORT,
        ...(input.format ? { response_format: { type: "json_object" } } : {})
      }),
      signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS)
    });
  } catch (error) {
    throw new ProviderError(`Meta Muse Spark ${error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached"}.`);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? " Check META_API_KEY." : res.status === 429 ? " Rate limited or out of credits." : "";
    throw new ProviderError(`Meta Muse Spark returned ${res.status}.${hint}`, res.status);
  }
  return { answer: readMetaAnswer(body).trim(), model };
}

// ---------------------------------------------------------------------------------------------
// Rich replies: the model picks a layout, a named dataset and actions; the numbers come from the data
// ---------------------------------------------------------------------------------------------

export type ChartUnit = "usd" | "count" | "percent";
export interface ChartData {
  kind: "bar" | "line";
  title: string;
  unit: ChartUnit;
  points: { label: string; value: number }[];
}

/** Datasets the assistant can chart. The model only names one; the values always come from the store data. */
export const DATASETS: Record<string, { description: string; build: (ctx: AssistantContext) => ChartData | null }> = {
  revenue_by_assistant: {
    description: "AI revenue per assistant (ChatGPT, Perplexity, ...)",
    build: ({ view }) => view && { kind: "bar", title: "AI revenue by assistant", unit: "usd", points: view.report.by_source.map(s => ({ label: s.label, value: s.revenue })) }
  },
  orders_by_assistant: {
    description: "AI orders per assistant",
    build: ({ view }) => view && { kind: "bar", title: "AI orders by assistant", unit: "count", points: view.report.by_source.map(s => ({ label: s.label, value: s.orders })) }
  },
  weekly_ai_revenue: {
    description: "AI revenue per week over the period (trend)",
    build: ({ view }) =>
      view && { kind: "line", title: "AI revenue by week", unit: "usd", points: view.report.weekly.map(w => ({ label: w.week_start.slice(5), value: w.ai_revenue })) }
  },
  weekly_ai_share: {
    description: "AI share of all revenue per week, in percent (trend)",
    build: ({ view }) =>
      view && {
        kind: "line",
        title: "AI share of revenue by week",
        unit: "percent",
        points: view.report.weekly.map(w => ({ label: w.week_start.slice(5), value: w.total_revenue ? Math.round((w.ai_revenue / w.total_revenue) * 1000) / 10 : 0 }))
      }
  },
  top_products: {
    description: "products with the most AI revenue",
    build: ({ view }) =>
      view && { kind: "bar", title: "Top products by AI revenue", unit: "usd", points: view.report.top_products.slice(0, 8).map(p => ({ label: p.title, value: p.revenue })) }
  },
  journeys: {
    description: "AI revenue by shopper journey (found via AI, came back via AI, both, bought inside AI)",
    build: ({ view }) => {
      const words: Record<string, string> = { both: "AI first & last", first: "Found via AI", last: "Came back via AI", checkout: "Bought inside AI" };
      return view && { kind: "bar", title: "AI revenue by journey", unit: "usd", points: view.report.by_touch.map(t => ({ label: words[t.touch] ?? t.touch, value: t.revenue })) };
    }
  },
  evidence: {
    description: "AI orders by proof type (UTM tag, AI referrer, AI checkout channel)",
    build: ({ view }) => view && { kind: "bar", title: "AI orders by proof", unit: "count", points: view.report.by_evidence.map(e => ({ label: e.evidence, value: e.orders })) }
  },
  answer_check_results: {
    description: "Answer Check results: matched, wrong, no answer",
    build: ({ answerCheck: a }) =>
      a
        ? { kind: "bar", title: "What AI says about your products", unit: "count", points: [{ label: "Matched catalog", value: a.consistent }, { label: "Wrong", value: a.contradictions }, { label: "No answer", value: a.noAnswer }] }
        : null
  }
};

/** Actions the assistant can offer. Each runs server-side with fixed code; the model only picks ids. */
export const ACTIONS: Record<string, { label: string; description: string }> = {
  draft_fix: { label: "Draft this week’s fix", description: "write the catalog fix for the top AI seller that AI gets wrong, ready to apply" },
  run_answer_check: { label: "Run Answer Check", description: "ask AI assistants about the products and list wrong answers" },
  watch_checkout: { label: "Watch an AI agent buy", description: "replay an AI shopping agent going to checkout, step by step" },
  export_ai_orders: { label: "Export AI orders (CSV)", description: "download every AI-attributed order with its proof" },
  open_ai_sales: { label: "Open AI Sales", description: "go to the AI Sales screen" },
  open_answer_check: { label: "Open Answer Check", description: "go to the Answer Check screen" },
  open_weekly_fix: { label: "Open Weekly Fix", description: "go to the Weekly Fix screen" }
};

export interface AssistantReply {
  headline: string;
  metrics: { label: string; value: string }[];
  bullets: string[];
  chart: ChartData | null;
  table: { columns: string[]; rows: string[][] } | null;
  actions: { id: string; label: string }[];
}

const RICH_FORMAT =
  "Reply ONLY with one JSON object, no prose around it: " +
  '{"headline": string (one sentence, the direct answer), ' +
  '"metrics": [{"label": string, "value": string}] (0 to 4 key numbers from the data, e.g. {"label":"AI revenue","value":"$161,933"}), ' +
  '"bullets": [string] (0 to 4 short evidence or next-step lines, each under 22 words), ' +
  `"chart": null or one of ${JSON.stringify(Object.keys(DATASETS))} (pick a chart only when it makes the answer clearer: trends use weekly_*, comparisons use *_by_*), ` +
  '"table": null or {"columns": [string], "rows": [[string]]} (only for lists of 3+ items with 2+ attributes, max 8 rows), ' +
  `"actions": [string] (0 to 3 ids from ${JSON.stringify(Object.keys(ACTIONS))} that the merchant would want next)}. ` +
  `Datasets: ${Object.entries(DATASETS).map(([k, d]) => `${k} = ${d.description}`).join("; ")}. ` +
  `Actions: ${Object.entries(ACTIONS).map(([k, a]) => `${k} = ${a.description}`).join("; ")}. ` +
  "Do not repeat in bullets what metrics or the chart already show.";

const asStr = (x: unknown) => (typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "");

/** Turns the model's JSON into a reply the UI can trust: unknown datasets and actions are dropped, sizes capped. */
export function parseRichReply(text: string, ctx: AssistantContext): AssistantReply {
  let raw: Record<string, unknown> | null = null;
  try {
    const start = text.indexOf("{");
    raw = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") {
    const lines = text.split("\n").map(l => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
    return { headline: lines[0] ?? "No answer came back.", metrics: [], bullets: lines.slice(1, 6), chart: null, table: null, actions: [] };
  }
  const metrics = (Array.isArray(raw.metrics) ? raw.metrics : [])
    .map((m: any) => ({ label: asStr(m?.label), value: asStr(m?.value) }))
    .filter(m => m.label && m.value)
    .slice(0, 4);
  const bullets = (Array.isArray(raw.bullets) ? raw.bullets : []).map(asStr).filter(Boolean).slice(0, 5);
  const chartKey = asStr(raw.chart);
  const chart = chartKey && DATASETS[chartKey] ? DATASETS[chartKey]!.build(ctx) : null;
  const t = raw.table as { columns?: unknown; rows?: unknown } | null;
  const columns = Array.isArray(t?.columns) ? t!.columns.map(asStr).slice(0, 5) : [];
  const rows = Array.isArray(t?.rows) ? (t!.rows as unknown[]).filter(Array.isArray).map(r => (r as unknown[]).map(asStr).slice(0, columns.length)).slice(0, 8) : [];
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .map(asStr)
    .filter((id, i, all) => ACTIONS[id] && all.indexOf(id) === i)
    .slice(0, 3)
    .map(id => ({ id, label: ACTIONS[id]!.label }));
  return {
    headline: asStr(raw.headline) || bullets[0] || "Here’s what the data shows.",
    metrics,
    bullets,
    chart: chart && chart.points.length > 0 ? chart : null,
    table: columns.length >= 2 && rows.length > 0 ? { columns, rows } : null,
    actions
  };
}

/** Like askAssistant, but the reply is structured for cards, charts and action buttons. */
export async function askAssistantRich(input: Parameters<typeof askAssistant>[0]): Promise<{ reply: AssistantReply; model: string }> {
  const env = input.env ?? process.env;
  const { answer, model } = await askAssistant({ ...input, env: { ...env }, format: RICH_FORMAT });
  return { reply: parseRichReply(answer, input.context), model };
}
