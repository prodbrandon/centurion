import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { askStore, assistantState } from "../centurion.server";

type Turn = { role: "user" | "assistant"; content: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return assistantState(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const question = String(form.get("question") ?? "");
  let history: Turn[] = [];
  try {
    history = JSON.parse(String(form.get("history") ?? "[]"));
  } catch {
    history = [];
  }
  try {
    const { answer } = await askStore(session.shop, question, history);
    return { ok: true as const, question, answer };
  } catch (error) {
    console.error("Ask Centurion failed", error);
    return { ok: false as const, question, error: error instanceof Error ? error.message : String(error) };
  }
};

export default function AskCenturion() {
  const state = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setTurns(t => [...t, { role: "assistant", content: fetcher.data!.ok ? fetcher.data!.answer : "" }]);
  }, [fetcher.state, fetcher.data]);

  const ask = (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const history = turns;
    setTurns([...history, { role: "user", content: question }]);
    setDraft("");
    fetcher.submit({ question, history: JSON.stringify(history) }, { method: "POST" });
  };

  return (
    <s-page heading="Ask Centurion">
      <s-button slot="primary-action" variant="primary" onClick={() => ask(draft)} {...(busy ? { loading: true } : {})} {...(!state.live ? { disabled: true } : {})}>
        Ask
      </s-button>

      {!state.live ? (
        <s-banner tone="warning" heading="Meta Muse Spark isn't connected">
          <s-paragraph>Set META_API_KEY in apps/shopify/.env and restart `shopify app dev` to ask questions about your store.</s-paragraph>
        </s-banner>
      ) : null}
      {state.demo ? (
        <s-banner tone="info" heading="Answering from the sample store">
          <s-paragraph>
            Your store has no AI orders yet, so Centurion answers from Northpine Outfitters, a fictional store with sample data. It switches
            to your own data as soon as your first report finds AI orders.
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading={`Your AI commerce analyst for ${state.storeName}`}>
        <s-stack gap="base">
          <s-paragraph>
            Ask in plain words. Meta Muse Spark answers only from your Centurion data (AI revenue, journeys, products and what AI assistants get
            wrong) and quotes the numbers it used. It reads; it never changes your store.
          </s-paragraph>
          <form
            onSubmit={e => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <s-text-field
              label="Your question"
              labelAccessibilityVisibility="exclusive"
              placeholder="Ask about AI revenue, products, or what AI gets wrong, then press Enter"
              value={draft}
              onInput={e => setDraft(e.currentTarget.value)}
              {...(busy || !state.live ? { disabled: true } : {})}
            />
          </form>
          {turns.length === 0 ? (
            <s-stack direction="inline" gap="small-200">
              {state.suggestions.map(s => (
                <s-button key={s} variant="secondary" onClick={() => ask(s)} {...(!state.live ? { disabled: true } : {})}>
                  {s}
                </s-button>
              ))}
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      {fetcher.state === "idle" && fetcher.data && !fetcher.data.ok ? (
        <s-banner tone="critical" heading="No answer this time">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      ) : null}

      {turns.length > 0 || busy ? (
        <s-section heading="Conversation">
          <s-stack gap="base">
            {turns.map((t, i) =>
              t.role === "user" ? (
                <s-text key={i} type="strong">
                  {t.content}
                </s-text>
              ) : (
                <s-box key={i} padding="base" background="subdued" borderRadius="base">
                  <s-stack gap="small-200">
                    {t.content
                      .split("\n")
                      .filter(Boolean)
                      .map((line, j) => (
                        <s-paragraph key={j}>{line}</s-paragraph>
                      ))}
                  </s-stack>
                </s-box>
              )
            )}
            {busy ? <s-text color="subdued">Reading your store data…</s-text> : null}
            {!busy ? (
              <s-button variant="tertiary" onClick={() => setTurns([])}>
                New conversation
              </s-button>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = headersArgs => boundary.headers(headersArgs);
