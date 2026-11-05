import { getShopifyToken, normalizeShopDomain } from "../../core/src/shopify-auth.ts";
import { OrderSchema, type Order, type Visit } from "./types.ts";

// Read-only fetch of recent orders with their customer journey from the Shopify Admin GraphQL API.
// Needs the read_orders scope. The Shopify app passes its own authenticated client to fetchOrdersWith;
// fetchOrders gets tokens through the client credentials grant (see packages/core/src/shopify-auth.ts).

const QUERY = `
query Orders($cursor: String, $query: String) {
  orders(first: 100, after: $cursor, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      totalPriceSet { shopMoney { amount currencyCode } }
      channelInformation { channelDefinition { channelName handle } app { title } }
      customerJourneySummary {
        firstVisit { ...V }
        lastVisit { ...V }
      }
      lineItems(first: 50) { nodes { title sku quantity originalTotalSet { shopMoney { amount } } } }
    }
  }
}
fragment V on CustomerVisit {
  occurredAt source sourceType referrerUrl landingPage
  utmParameters { source medium campaign }
}`;

interface RawVisit {
  occurredAt?: string | null;
  source?: string | null;
  sourceType?: string | null;
  referrerUrl?: string | null;
  landingPage?: string | null;
  utmParameters?: { source?: string | null; medium?: string | null; campaign?: string | null } | null;
}

function mapVisit(v: RawVisit | null | undefined): Visit | null {
  if (!v) return null;
  return {
    occurredAt: v.occurredAt ?? null,
    source: v.source ?? null,
    sourceType: v.sourceType ?? null,
    referrerUrl: v.referrerUrl ?? null,
    landingPage: v.landingPage ?? null,
    utmSource: v.utmParameters?.source ?? null,
    utmMedium: v.utmParameters?.medium ?? null,
    utmCampaign: v.utmParameters?.campaign ?? null
  };
}

/** Runs one Admin GraphQL request and returns the parsed body. Lets the Shopify app pass its own authenticated client. */
export type GraphqlRunner = (
  query: string,
  variables: Record<string, unknown>
) => Promise<{ data?: any; errors?: { message: string }[] }>;

export interface FetchOrdersOptions {
  /** Store handle or myshopify.com domain. Defaults to SHOPIFY_SHOP. */
  shop?: string;
  days: number;
  apiVersion?: string;
  /** Returns an Admin API access token. Defaults to getShopifyToken (client credentials grant). */
  getToken?: (shop: string) => Promise<string>;
}

/** Direct fetch against the Admin API (CLI use). A token is requested per page, so long runs survive a refresh. */
export async function fetchOrders(opts: FetchOrdersOptions): Promise<Order[]> {
  const shop = opts.shop ?? process.env.SHOPIFY_SHOP;
  if (!shop) throw new Error("Set SHOPIFY_SHOP or pass a shop.");
  const domain = normalizeShopDomain(shop);
  const getToken = opts.getToken ?? (s => getShopifyToken({ shop: s }));
  const version = opts.apiVersion ?? process.env.SHOPIFY_API_VERSION ?? "2026-10";
  const url = `https://${domain}/admin/api/${version}/graphql.json`;
  const run: GraphqlRunner = async (query, variables) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await getToken(domain) },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000)
    });
    if (res.status === 401) throw new Error(`Shopify returned HTTP 401 for ${domain}. The access token was not accepted.`);
    if (res.status === 403) throw new Error(`Shopify returned HTTP 403 for ${domain}. The app needs the read_orders scope on this store.`);
    if (res.status === 429) throw new Error("Shopify rate limit hit. Wait a minute and retry.");
    if (!res.ok) throw new Error(`Shopify returned HTTP ${res.status}.`);
    return (await res.json()) as { data?: any; errors?: { message: string }[] };
  };
  return fetchOrdersWith(run, opts.days);
}

/** Pages through orders created in the last `days` days using any GraphQL runner. */
export async function fetchOrdersWith(run: GraphqlRunner, days: number): Promise<Order[]> {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const orders: Order[] = [];
  let cursor: string | null = null;

  do {
    const body = await run(QUERY, { cursor, query: `created_at:>=${since}` });
    if (body.errors?.length) throw new Error(`Shopify GraphQL error: ${body.errors.map(e => e.message).join("; ")}`);

    const page = body.data.orders;
    for (const n of page.nodes) {
      const channel = n.channelInformation?.app?.title ?? n.channelInformation?.channelDefinition?.channelName ?? null;
      orders.push(
        OrderSchema.parse({
          id: n.id,
          name: n.name,
          createdAt: n.createdAt,
          total: Number(n.totalPriceSet.shopMoney.amount),
          currency: n.totalPriceSet.shopMoney.currencyCode,
          channel,
          firstVisit: mapVisit(n.customerJourneySummary?.firstVisit),
          lastVisit: mapVisit(n.customerJourneySummary?.lastVisit),
          lineItems: n.lineItems.nodes.map((li: any) => ({
            title: li.title,
            sku: li.sku,
            quantity: li.quantity,
            total: Number(li.originalTotalSet.shopMoney.amount)
          }))
        })
      );
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return orders;
}
