import { SalesExplorer } from "@/components/SalesExplorer";
import { getAiSales, shortDate } from "@/lib/data";

const listWords = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export default async function AiSalesPage() {
  const sales = await getAiSales();
  const data = sales.view;
  if (!data) {
    return (
      <section className="card">
        <h2>No report yet</h2>
        <p className="sub">
          Open Centurion in the Shopify admin for {sales.mode === "live" ? sales.shop : "this store"} and run the first report. It
          shows up here as soon as it finishes.
        </p>
      </section>
    );
  }
  const r = data.report;
  if (r.orders === 0) {
    return (
      <section className="card">
        <h2>No orders in this period</h2>
        <p className="sub">The last report found no orders. Once the store has orders, run the report again in the Shopify admin.</p>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>AI Revenue</h1>
          <p className="sub">
            Orders that {listWords(r.by_source.map(s => s.label)) || "AI assistants"} sent you, each with proof. {shortDate(r.period.from)} to {shortDate(r.period.to)}.
          </p>
        </div>
        <span className="tag">AI source list v{data.signaturesVersion}</span>
      </section>
      <SalesExplorer view={data} />
    </div>
  );
}
