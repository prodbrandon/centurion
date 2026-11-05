import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { AssistantReply, ChartData } from "@centurion/core/server";
import { authenticate } from "../shopify.server";
import { applyStoreFix, askStoreRich, assistantState, runErrorMessage, runStoreAction, undoStoreFix, type ShopCard } from "../centurion.server";

type Applied = { productId: string; adminUrl: string; createdProduct: boolean; beforeHtml: string; afterHtml: string };
type Result =
  | { ok: false; intent: string; error: string }
  | { ok: true; intent: "ask"; reply: AssistantReply }
  | { ok: true; intent: "act"; id: string; card: ShopCard }
  | { ok: true; intent: "apply"; applied: Applied }
  | { ok: true; intent: "undo" };

type Turn = { role: "user"; text: string } | { role: "bot"; reply: AssistantReply } | { role: "card"; card: ShopCard; label: string };

const LABELS: Record<string, string> = {
  draft_fix: "Draft this week’s fix",
  run_answer_check: "Run Answer Check",
  watch_checkout: "Watch an AI agent buy",
  export_ai_orders: "Export AI orders (CSV)"
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return assistantState(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs): Promise<Result> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "ask");
  try {
    if (intent === "ask") {
      let history: { role: "user" | "assistant"; content: string }[] = [];
      try {
        history = JSON.parse(String(form.get("history") ?? "[]"));
      } catch {}
      return { ok: true, intent: "ask", reply: await askStoreRich(session.shop, String(form.get("question") ?? ""), history) };
    }
    if (intent === "act") {
      const id = String(form.get("id") ?? "");
      return { ok: true, intent: "act", id, card: await runStoreAction(session.shop, id) };
    }
    if (intent === "apply") return { ok: true, intent: "apply", applied: await applyStoreFix(session.shop, admin.graphql) };
    if (intent === "undo") {
      await undoStoreFix(admin.graphql, {
        productId: String(form.get("productId") ?? ""),
        beforeHtml: String(form.get("beforeHtml") ?? ""),
        afterHtml: String(form.get("afterHtml") ?? "")
      });
      return { ok: true, intent: "undo" };
    }
    return { ok: false, intent, error: "Unknown request." };
  } catch (error) {
    console.error(`Ask Centurion ${intent} failed`, error);
    return { ok: false, intent, error: runErrorMessage(error) };
  }
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const fmt = (v: number, unit: ChartData["unit"]) => (unit === "usd" ? money(v) : unit === "percent" ? `${v}%` : Math.round(v).toLocaleString("en-US"));

export default function AskCenturion() {
  const state = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const busy = fetcher.state !== "idle";
  const pendingLabel = useRef<string>("");

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data;
    if (!d.ok) {
      if (d.intent === "ask" || d.intent === "act") shopify.toast.show(d.error, { isError: true });
      return;
    }
    if (d.intent === "ask") setTurns(t => [...t, { role: "bot", reply: d.reply }]);
    if (d.intent === "act") {
      const card = d.card;
      if (card.type === "navigate") navigate(card.href);
      else setTurns(t => [...t, { role: "card", card, label: LABELS[d.id] ?? d.id }]);
    }
  }, [fetcher.state, fetcher.data, navigate, shopify]);

  const history = () =>
    turns.flatMap((t): { role: "user" | "assistant"; content: string }[] =>
      t.role === "user" ? [{ role: "user", content: t.text }] : t.role === "bot" ? [{ role: "assistant", content: [t.reply.headline, ...t.reply.bullets].join("\n") }] : []
    );
  const ask = (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setTurns(t => [...t, { role: "user", text: question }]);
    setDraft("");
    fetcher.submit({ intent: "ask", question, history: JSON.stringify(history()) }, { method: "POST" });
  };
  const act = (id: string) => {
    if (busy) return;
    pendingLabel.current = LABELS[id] ?? id;
    fetcher.submit({ intent: "act", id }, { method: "POST" });
  };

  return (
    <s-page heading="Ask Centurion">
      <s-button slot="primary-action" variant="primary" onClick={() => act("draft_fix")} {...(busy ? { loading: true } : {})}>
        Draft this week’s fix
      </s-button>

      {!state.live ? (
        <s-banner tone="warning" heading="Meta Muse Spark isn't connected">
          <s-paragraph>Set META_API_KEY in apps/shopify/.env and restart `shopify app dev` to ask questions. Actions below work without it.</s-paragraph>
        </s-banner>
      ) : null}
      {state.demo ? (
        <s-banner tone="info" heading="Answering from the sample store">
          <s-paragraph>
            Your store has no AI orders yet, so Centurion reads Northpine Outfitters, a fictional store with sample data. Applying a fix writes to
            a demo product on this store (created on first use) when CENTURION_STORE_WRITES=on.
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading={`Your AI commerce analyst for ${state.storeName}`}>
        <s-stack gap="base">
          <form
            onSubmit={e => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <s-text-field
              label="Ask a question"
              labelAccessibilityVisibility="exclusive"
              placeholder="Ask about AI revenue, products, or what AI gets wrong, then press Enter"
              value={draft}
              onInput={e => setDraft(e.currentTarget.value)}
              {...(busy || !state.live ? { disabled: true } : {})}
            />
          </form>
          <s-stack direction="inline" gap="small-200">
            {Object.entries(LABELS).map(([id, label]) => (
              <s-button key={id} onClick={() => act(id)} {...(busy ? { disabled: true } : {})}>
                {label}
              </s-button>
            ))}
          </s-stack>
          {turns.length === 0 ? (
            <s-stack direction="inline" gap="small-200">
              {state.suggestions.map(s => (
                <s-button key={s} variant="tertiary" onClick={() => ask(s)} {...(!state.live || busy ? { disabled: true } : {})}>
                  {s}
                </s-button>
              ))}
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      {turns.map((t, i) =>
        t.role === "user" ? (
          <s-section key={i}>
            <s-text type="strong">You asked: {t.text}</s-text>
          </s-section>
        ) : t.role === "bot" ? (
          <s-section key={i}>
            <ReplyView reply={t.reply} onAction={act} busy={busy} />
          </s-section>
        ) : (
          <s-section key={i} heading={t.label}>
            <CardView card={t.card} />
          </s-section>
        )
      )}
      {busy ? (
        <s-section>
          <s-text color="subdued">Working on it…</s-text>
        </s-section>
      ) : null}
      {turns.length > 0 && !busy ? (
        <s-button variant="tertiary" onClick={() => setTurns([])}>
          New conversation
        </s-button>
      ) : null}
    </s-page>
  );
}

function ReplyView({ reply, onAction, busy }: { reply: AssistantReply; onAction: (id: string) => void; busy: boolean }) {
  return (
    <s-stack gap="base">
      <s-heading>{reply.headline}</s-heading>
      {reply.metrics.length ? (
        <s-grid gridTemplateColumns={`repeat(${reply.metrics.length}, 1fr)`} gap="base">
          {reply.metrics.map(m => (
            <s-box key={m.label} padding="base" borderWidth="base" borderRadius="base">
              <s-stack gap="small-300">
                <s-text type="strong">{m.value}</s-text>
                <s-text color="subdued">{m.label}</s-text>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      ) : null}
      {reply.chart ? <Chart data={reply.chart} /> : null}
      {reply.table ? (
        <s-table>
          <s-table-header-row>
            {reply.table.columns.map((c, i) => (
              <s-table-header key={c} {...(i === 0 ? { listSlot: "primary" as const } : {})}>
                {c}
              </s-table-header>
            ))}
          </s-table-header-row>
          <s-table-body>
            {reply.table.rows.map((r, i) => (
              <s-table-row key={i}>
                {r.map((c, j) => (
                  <s-table-cell key={j}>{c}</s-table-cell>
                ))}
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      ) : null}
      {reply.bullets.length ? (
        <s-unordered-list>
          {reply.bullets.map(b => (
            <s-list-item key={b}>{b}</s-list-item>
          ))}
        </s-unordered-list>
      ) : null}
      {reply.actions.length ? (
        <s-stack direction="inline" gap="small-200">
          {reply.actions.map((a, i) => (
            <s-button key={a.id} {...(i === 0 ? { variant: "primary" as const } : {})} onClick={() => onAction(a.id)} {...(busy ? { disabled: true } : {})}>
              {a.label}
            </s-button>
          ))}
        </s-stack>
      ) : null}
    </s-stack>
  );
}

/** A small SVG chart with Polaris-neutral colors; the values come from the store data, not the model. */
function Chart({ data }: { data: ChartData }) {
  const max = Math.max(...data.points.map(p => p.value), 1);
  if (data.kind === "bar") {
    return (
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-stack gap="small-200">
          <s-text color="subdued">{data.title}</s-text>
          {data.points.map((p, i) => (
            <div key={p.label}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{p.label}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(p.value, data.unit)}</span>
              </div>
              <div style={{ height: 8, background: "#f1f1f1", borderRadius: 4, marginTop: 4 }}>
                <div style={{ width: `${Math.max((p.value / max) * 100, 1.5)}%`, height: 8, borderRadius: 4, background: i === 0 ? "#303030" : "#8a8a8a" }} />
              </div>
            </div>
          ))}
        </s-stack>
      </s-box>
    );
  }
  const W = 600;
  const H = 140;
  const n = data.points.length;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - 6 - (v / max) * (H - 12);
  const d = data.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const peak = data.points.reduce((a, b) => (b.value > a.value ? b : a), data.points[0]!);
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{data.title}</s-text>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 140, display: "block" }} role="img" aria-label={`${data.title}, peak ${fmt(peak.value, data.unit)}`}>
          <path d={`${d} L${W},${H} L0,${H} Z`} fill="rgba(48,48,48,0.08)" />
          <path d={d} fill="none" stroke="#303030" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#616161" }}>
          <span>{data.points[0]!.label}</span>
          <span>
            Peak {fmt(peak.value, data.unit)} · {peak.label}
          </span>
          <span>{data.points.at(-1)!.label}</span>
        </div>
      </s-stack>
    </s-box>
  );
}

function CardView({ card }: { card: ShopCard }) {
  if (card.type === "fix") return <FixCard card={card} />;
  if (card.type === "answer_check") {
    return (
      <s-stack gap="base">
        <s-text>
          {card.asked} questions: {card.matched} matched your catalog, {card.wrong} were wrong, {card.noAnswer} didn’t answer (sample answers).
        </s-text>
        {card.top.map(t => (
          <s-box key={t.product + t.said} padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-300">
              <s-text type="strong">
                {t.product} · {t.assistant}
              </s-text>
              <s-text>
                Said “{t.said}”. Catalog: {t.truth}
              </s-text>
            </s-stack>
          </s-box>
        ))}
      </s-stack>
    );
  }
  if (card.type === "checkout") {
    return (
      <s-stack gap="small-200">
        <s-text color="subdued">Recorded run on a test page: {card.run.query ? `the agent looked for “${card.run.query}”` : ""}.</s-text>
        {card.run.steps.map(s => (
          <s-stack key={s.n} direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={s.status === "passed" ? "success" : s.status === "slowed" ? "warning" : "critical"}>{s.status}</s-badge>
            <s-text>
              {s.n}. {s.title}
              {s.hint ? ` · Fix: ${s.hint}` : ""}
            </s-text>
          </s-stack>
        ))}
        <s-text type="strong">{card.run.result === "reached_checkout" ? "Reached checkout and stopped before payment." : `Blocked at step ${card.run.failedStep}.`}</s-text>
      </s-stack>
    );
  }
  if (card.type === "csv") {
    const download = () => {
      const url = URL.createObjectURL(new Blob([card.csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = card.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return (
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-text>{card.rows.toLocaleString("en-US")} AI orders ready.</s-text>
        <s-button onClick={download}>Download {card.filename}</s-button>
      </s-stack>
    );
  }
  return null;
}

function FixCard({ card }: { card: Extract<ShopCard, { type: "fix" }> }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [applied, setApplied] = useState<Applied | null>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data;
    if (!d.ok) shopify.toast.show(d.error, { isError: true });
    else if (d.intent === "apply") {
      setApplied(d.applied);
      shopify.toast.show(`Fix is live on ${card.product}`);
    } else if (d.intent === "undo") {
      setApplied(null);
      shopify.toast.show("Fix undone");
    }
  }, [fetcher.state, fetcher.data, shopify, card.product]);

  return (
    <s-stack gap="base">
      <s-paragraph>
        {card.product}: {money(card.aiRevenue)} of AI sales in {card.periodDays} days
        {card.finding ? `, but ${card.finding.provider} said “${card.finding.said}”. Your catalog says ${card.finding.truth}.` : "."}
      </s-paragraph>
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-stack gap="small-200">
          <s-text type="strong">{applied ? card.addition : `+ ${card.addition}`}</s-text>
          <s-text color="subdued">{card.before}</s-text>
        </s-stack>
      </s-box>
      {!card.live ? (
        <s-banner tone="info">
          <s-paragraph>Store writes are off. Set CENTURION_STORE_WRITES=on in apps/shopify/.env and restart to apply this to your store.</s-paragraph>
        </s-banner>
      ) : applied ? (
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-badge tone="success">Live{applied.createdProduct ? " · demo product created" : ""}</s-badge>
          <s-link href={applied.adminUrl} target="_blank">
            View the product in Shopify admin
          </s-link>
          <s-button
            onClick={() => fetcher.submit({ intent: "undo", productId: applied.productId, beforeHtml: applied.beforeHtml, afterHtml: applied.afterHtml }, { method: "POST" })}
            {...(busy ? { loading: true } : {})}
          >
            Undo
          </s-button>
        </s-stack>
      ) : (
        <s-button variant="primary" onClick={() => fetcher.submit({ intent: "apply" }, { method: "POST" })} {...(busy ? { loading: true } : {})}>
          Apply to {card.product} in this store
        </s-button>
      )}
      <s-text color="subdued">Measured next week against {card.holdouts.join(" and ")}.</s-text>
    </s-stack>
  );
}

export const headers: HeadersFunction = headersArgs => boundary.headers(headersArgs);
