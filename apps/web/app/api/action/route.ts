import { NextResponse } from "next/server";
import {
  ACTIONS,
  applyFixLive,
  clientCredentialsRunner,
  liveStoreWrites,
  undoFixLive,
  createAnswerProviders,
  DEMO_NORTHPINE_CATALOG,
  DEMO_SALES_SNAPSHOT,
  findings,
  runAnswerCheck,
  suggestFix,
  TEST_PAGE_CHECKOUT_RUN
} from "@centurion/core/server";
import { getAiSales } from "@/lib/data";

// Actions Ask Centurion can run from the chat. Each is fixed code; the model only picks an id.
// The demo never writes to a store: "apply" on a drafted fix happens on a copy in the browser.
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function POST(request: Request) {
  let id = "";
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
    id = String(body.id ?? "");
  } catch {
    /* empty body */
  }
  // apply_fix and undo_fix come from the fix card's buttons, not from the model.
  if (!ACTIONS[id] && id !== "apply_fix" && id !== "undo_fix") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  // Fixture answers on the demo catalog: no model call, so actions are instant and repeatable.
  const fixtureCheck = () => runAnswerCheck({ catalog: DEMO_NORTHPINE_CATALOG, providers: createAnswerProviders({}) });
  const demoFix = async () => suggestFix({ sales: DEMO_SALES_SNAPSHOT, answerCheck: await fixtureCheck(), catalog: DEMO_NORTHPINE_CATALOG });

  try {
    switch (id) {
      case "apply_fix": {
        const s = await demoFix();
        const product = DEMO_NORTHPINE_CATALOG.products.find(p => p.id === s?.productId);
        if (!s || !product) return NextResponse.json({ error: "There is no fix to apply." }, { status: 400 });
        if (!liveStoreWrites()) return NextResponse.json({ live: false });
        const shop = process.env.SHOPIFY_SHOP!;
        return NextResponse.json({ live: true, shop, ...(await applyFixLive(clientCredentialsRunner(), shop, s, product)) });
      }
      case "undo_fix": {
        const s = await demoFix();
        if (!s || !liveStoreWrites()) return NextResponse.json({ live: false });
        const result = await undoFixLive(clientCredentialsRunner(), {
          productId: String(body.productId ?? ""),
          suggestion: s,
          beforeHtml: String(body.beforeHtml ?? ""),
          afterHtml: String(body.afterHtml ?? "")
        });
        return NextResponse.json({ live: true, result });
      }
      case "draft_fix": {
        const s = await demoFix();
        if (!s) return NextResponse.json({ card: { type: "note", text: "Nothing to fix this week: AI gets no top seller wrong." } });
        const before = DEMO_NORTHPINE_CATALOG.products.find(p => p.id === s.productId)?.description ?? "";
        return NextResponse.json({
          card: {
            type: "fix",
            product: s.productTitle,
            addition: s.addition,
            before,
            aiRevenue: s.evidence.aiRevenue,
            periodDays: s.evidence.periodDays,
            finding: s.evidence.findings[0] ?? null,
            holdouts: s.holdouts.map(h => h.title),
            live: liveStoreWrites(),
            shop: liveStoreWrites() ? process.env.SHOPIFY_SHOP : null
          }
        });
      }
      case "run_answer_check": {
        const run = await fixtureCheck();
        return NextResponse.json({
          card: {
            type: "answer_check",
            asked: run.asked,
            matched: run.consistent,
            wrong: run.contradictions,
            noAnswer: run.noAnswer,
            fixture: run.mode !== "live",
            top: findings(run)
              .slice(0, 4)
              .map(r => ({ product: r.subject, assistant: r.providerLabel, said: r.issues[0]?.said ?? "", truth: r.issues[0]?.truth ?? "" }))
          }
        });
      }
      case "watch_checkout":
        return NextResponse.json({ card: { type: "checkout", run: TEST_PAGE_CHECKOUT_RUN } });
      case "export_ai_orders": {
        const { view } = await getAiSales();
        const rows = (view?.aiOrders ?? []).map(o => [o.name, o.createdAt.slice(0, 10), o.source, o.total, o.evidence, o.touch, o.proof.join(" | ")]);
        const csv = [["order", "date", "assistant", "total", "evidence", "journey", "proof"], ...rows].map(r => r.map(csvCell).join(",")).join("\n");
        return NextResponse.json({ card: { type: "csv", filename: `ai-orders-${view?.report.period.to ?? "export"}.csv`, rows: rows.length, csv } });
      }
      default: {
        const href = { open_ai_sales: "/", open_answer_check: "/answer-check", open_weekly_fix: "/weekly-fix" }[id] ?? "/";
        return NextResponse.json({ card: { type: "navigate", href, label: ACTIONS[id]!.label } });
      }
    }
  } catch (error) {
    console.error(`Action ${id} failed`, error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "The action failed." }, { status: 500 });
  }
}
