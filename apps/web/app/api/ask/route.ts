import { NextResponse } from "next/server";
import { askAssistantRich, createAnswerProviders, DEMO_NORTHPINE_CATALOG, runAnswerCheck, type AssistantTurn } from "@centurion/core/server";
import { getAiSales } from "@/lib/data";

// Ask Centurion: Meta Muse Spark answers from this store's Centurion data. Read-only.
export async function POST(request: Request) {
  let body: { question?: unknown; history?: unknown; screen?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON with a question." }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question : "";
  const history = Array.isArray(body.history) ? (body.history as AssistantTurn[]) : [];
  const screen = typeof body.screen === "string" ? body.screen.slice(0, 40) : undefined;
  try {
    const sales = await getAiSales();
    // The labeled fixture Answer Check on the demo catalog: no model call, so it adds no latency.
    const answerCheck = sales.mode === "demo" ? await runAnswerCheck({ catalog: DEMO_NORTHPINE_CATALOG, providers: createAnswerProviders({}) }) : null;
    const result = await askAssistantRich({ question, history, context: { view: sales.view, answerCheck, demo: sales.mode === "demo", screen } });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Ask Centurion failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Something went wrong." }, { status: 502 });
  }
}
