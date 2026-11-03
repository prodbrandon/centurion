// Runs an Answer Check: asks each provider each question, then compares every answer with the catalog.
// A provider error marks that one answer as an error; the run always finishes.
import { compareAnswer } from "./compare.ts";
import { NoFixtureError, type AnswerProvider } from "./providers.ts";
import { buildQuestions } from "./questions.ts";
import type { AnswerCheckRun, AnswerResult, Catalog, Question } from "./types.ts";

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function runAnswerCheck(input: {
  catalog: Catalog;
  providers: AnswerProvider[];
  questions?: Question[];
  now?: Date;
  /** Parallel requests per run. Defaults to 3 to stay well under provider rate limits. */
  concurrency?: number;
}): Promise<AnswerCheckRun> {
  const { catalog, providers } = input;
  const questions = input.questions ?? buildQuestions(catalog);
  const pairs = providers.flatMap(provider => questions.map(question => ({ provider, question })));

  const answered = await mapLimit(pairs, input.concurrency ?? 3, async ({ provider, question }): Promise<AnswerResult | null> => {
    const base = { questionId: question.id, question: question.text, subject: question.subject.title, provider: provider.id, providerLabel: provider.label };
    let answer: string;
    try {
      answer = await provider.ask(question, catalog);
    } catch (error) {
      if (error instanceof NoFixtureError) return null;
      return { ...base, status: "error", error: error instanceof Error ? error.message : String(error), issues: [] };
    }
    const { status, issues } = compareAnswer(answer, question, catalog);
    return { ...base, status, answer, issues };
  });
  const results = answered.filter((r): r is AnswerResult => r !== null);
  const count = (s: AnswerResult["status"]) => results.filter(r => r.status === s).length;

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    mode: providers.length > 0 && providers.every(p => p.mode === "live") ? "live" : "fixture",
    store: catalog.store,
    demoCatalog: catalog.demo,
    providers: providers.map(({ id, label, model, mode }) => ({ id, label, model, mode })),
    asked: results.length,
    consistent: count("consistent"),
    contradictions: count("contradiction"),
    noAnswer: count("no_answer"),
    errors: count("error"),
    results
  };
}

/** Contradictions first (high severity before medium), then the rest in question order. */
export function findings(run: AnswerCheckRun): AnswerResult[] {
  const rank = (r: AnswerResult) => (r.issues.some(i => i.severity === "high") ? 0 : r.issues.length > 0 ? 1 : 2);
  return run.results.filter(r => r.status === "contradiction").sort((a, b) => rank(a) - rank(b));
}
