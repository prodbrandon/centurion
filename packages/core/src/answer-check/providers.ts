// Model providers for Answer Check. Answers come from official model APIs only, never from scraping
// chat interfaces. Meta (Llama API) is the primary provider and goes live as soon as META_API_KEY is set,
// with no code change. Without a key, and for providers whose live clients are not built yet, answers
// come from DEMO fixtures that are labeled as such on every screen.
import { DEMO_FIXTURE_ANSWERS } from "./demo-fixtures.ts";
import type { Catalog, ProviderId, ProviderInfo, Question } from "./types.ts";

export interface AnswerProvider extends ProviderInfo {
  ask(question: Question, catalog: Catalog): Promise<string>;
}

export type ProviderEnv = Record<string, string | undefined>;

/** Thrown by a fixture provider that has no sample answer for a question. The question is skipped, not counted. */
export class NoFixtureError extends Error {
  constructor(provider: ProviderId, questionId: string) {
    super(`No fixture answer from ${provider} for ${questionId}`);
    this.name = "NoFixtureError";
  }
}

export class ProviderError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

// Llama API (https://api.llama.com). Model and base URL can be changed without a code change.
export const META_DEFAULT_BASE_URL = "https://api.llama.com/v1";
export const META_DEFAULT_MODEL = "Llama-4-Maverick-17B-128E-Instruct-FP8";
const META_TIMEOUT_MS = 30_000;

export const SYSTEM_PROMPT =
  "You are a helpful shopping assistant. A shopper is asking about an online store and its products. " +
  "Answer in two to four plain sentences with the specific facts a shopper would rely on (prices, sizes, weights, materials, policies). " +
  "If you don't know, say so.";

export function userPrompt(question: Question, catalog: Catalog): string {
  return `Store: ${catalog.store.name} (${catalog.store.domain})\nQuestion: ${question.text}`;
}

/** Reads the assistant text from a Llama API response, or from an OpenAI-compatible one. */
export function readMetaAnswer(body: unknown): string {
  const b = body as {
    completion_message?: { content?: string | { type?: string; text?: string } | { type?: string; text?: string }[] };
    choices?: { message?: { content?: string } }[];
  };
  const content = b?.completion_message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(c => c?.text ?? "").join("");
  if (content && typeof content.text === "string") return content.text;
  const openai = b?.choices?.[0]?.message?.content;
  if (typeof openai === "string") return openai;
  throw new ProviderError("The Llama API response had no answer text.");
}

function errorDetail(body: unknown): string {
  const b = body as { error?: { message?: unknown } | string; detail?: unknown; message?: unknown };
  const raw = typeof b?.error === "string" ? b.error : (b?.error?.message ?? b?.detail ?? b?.message);
  return typeof raw === "string" ? `: ${raw.slice(0, 200)}` : "";
}

/** The live Llama API client. Never logs or returns the key. */
export function metaLiveProvider(opts: { apiKey: string; model?: string; baseUrl?: string; fetch?: typeof fetch }): AnswerProvider {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const model = opts.model || META_DEFAULT_MODEL;
  const url = `${(opts.baseUrl || META_DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
  return {
    id: "meta",
    label: "Meta Llama",
    model,
    mode: "live",
    async ask(question, catalog) {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt(question, catalog) }
            ],
            temperature: 0,
            max_completion_tokens: 300
          }),
          signal: AbortSignal.timeout(META_TIMEOUT_MS)
        });
      } catch (error) {
        const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached";
        throw new ProviderError(`The Llama API ${reason}.`);
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON error page */
      }
      if (!res.ok) {
        const hint = res.status === 401 || res.status === 403 ? " Check META_API_KEY." : res.status === 429 ? " Rate limited or out of credits." : "";
        throw new ProviderError(`The Llama API returned ${res.status}${errorDetail(body)}.${hint}`, res.status);
      }
      return readMetaAnswer(body).trim();
    }
  };
}

const FIXTURE_INFO: Record<ProviderId, { label: string; model: string }> = {
  meta: { label: "Meta Llama", model: META_DEFAULT_MODEL },
  openai: { label: "ChatGPT", model: "gpt (fixture)" },
  perplexity: { label: "Perplexity", model: "sonar (fixture)" },
  gemini: { label: "Gemini", model: "gemini (fixture)" }
};

/** Returns DEMO sample answers keyed by question id. Never calls a network. */
export function fixtureProvider(id: ProviderId, answers: Record<string, string> = DEMO_FIXTURE_ANSWERS[id]): AnswerProvider {
  const info = FIXTURE_INFO[id];
  return {
    id,
    label: info.label,
    model: info.model,
    mode: "fixture",
    async ask(question) {
      const answer = answers[question.id];
      if (answer === undefined) throw new NoFixtureError(id, question.id);
      return answer;
    }
  };
}

export const isMetaLive = (env: ProviderEnv) => Boolean(env.META_API_KEY?.trim());

/**
 * The providers for a run. META_API_KEY set: the live Meta provider only (the others need keys too, so
 * live runs never mix in sample answers). Not set: all four providers on DEMO fixtures.
 */
export function createAnswerProviders(env: ProviderEnv = process.env, opts: { fetch?: typeof fetch } = {}): AnswerProvider[] {
  if (isMetaLive(env)) {
    return [metaLiveProvider({ apiKey: env.META_API_KEY!.trim(), model: env.META_MODEL, baseUrl: env.META_API_BASE_URL, fetch: opts.fetch })];
  }
  return (["meta", "openai", "perplexity", "gemini"] as const).map(id => fixtureProvider(id));
}
