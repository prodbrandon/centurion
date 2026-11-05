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
}

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
          { role: "system", content: `${ASSISTANT_SYSTEM_PROMPT}\n\nSTORE DATA\n${storeBriefing(input.context)}` },
          ...history,
          { role: "user", content: question }
        ],
        max_completion_tokens: ASSISTANT_MAX_COMPLETION_TOKENS,
        reasoning_effort: env.META_REASONING_EFFORT || ASSISTANT_REASONING_EFFORT
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
