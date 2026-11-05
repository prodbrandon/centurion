// Builds an Answer Check catalog from a live Shopify store through the Admin GraphQL API
// (needs the read_products scope). Banned and approved claims are read from the product
// metafields centurion.prohibited_claims and centurion.approved_claims (list of text, or comma-separated text),
// and spec facts from centurion.facts (a JSON object such as {"weight": "1.3 kg", "material": "100% merino"}).
import type { GraphqlRunner } from "../../../attribution/src/shopify.ts";
import type { Catalog, CatalogProduct } from "./types.ts";

export const CATALOG_QUERY = `#graphql
  query CenturionCatalog($first: Int!) {
    shop { name myshopifyDomain }
    products(first: $first, sortKey: UPDATED_AT, reverse: true, query: "status:active") {
      nodes {
        id
        title
        updatedAt
        tracksInventory
        totalInventory
        priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
        variants(first: 50) { nodes { inventoryPolicy } }
        prohibited: metafield(namespace: "centurion", key: "prohibited_claims") { value }
        approved: metafield(namespace: "centurion", key: "approved_claims") { value }
        facts: metafield(namespace: "centurion", key: "facts") { value updatedAt }
      }
    }
  }`;

interface ProductNode {
  id: string;
  title: string;
  updatedAt: string;
  tracksInventory: boolean;
  totalInventory: number | null;
  priceRangeV2?: { minVariantPrice?: { amount: string; currencyCode: string }; maxVariantPrice?: { amount: string; currencyCode: string } };
  variants?: { nodes: { inventoryPolicy: string }[] };
  prohibited?: { value: string } | null;
  approved?: { value: string } | null;
  facts?: { value: string; updatedAt?: string } | null;
}

/** Metafield text: a JSON list ("list.single_line_text_field") or comma-separated text. */
export function parseClaims(value: string | undefined | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).map(s => s.trim()).filter(Boolean);
  } catch {
    /* plain text */
  }
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

/** The centurion.facts metafield: {"weight": "1.3 kg"} or [{"attribute": "weight", "value": "1.3 kg"}]. Anything else gives no facts. */
export function parseFacts(value: string | undefined | null): { attribute: string; value: string }[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    const pairs: [unknown, unknown][] = Array.isArray(parsed) ? parsed.map(f => [f?.attribute, f?.value]) : Object.entries(parsed ?? {});
    return pairs
      .filter((p): p is [string, string | number] => typeof p[0] === "string" && (typeof p[1] === "string" || typeof p[1] === "number"))
      .map(([attribute, v]) => ({ attribute: attribute.trim().toLowerCase().replace(/\s+/g, "_"), value: String(v).trim() }))
      .filter(f => f.attribute && f.value);
  } catch {
    return [];
  }
}

export function productFromNode(n: ProductNode): CatalogProduct {
  const updated = n.updatedAt?.slice(0, 10);
  const price = n.priceRangeV2?.minVariantPrice;
  const max = n.priceRangeV2?.maxVariantPrice;
  // A variant set to keep selling when out of stock ("continue selling") can always be ordered, so stock is not judged.
  const sellsWhenOut = (n.variants?.nodes ?? []).some(v => v.inventoryPolicy === "CONTINUE");
  return {
    id: n.id,
    title: n.title,
    price: price
      ? { amount: Number(price.amount), max: max ? Number(max.amount) : undefined, currency: price.currencyCode, source: { system: "shopify", ref: "product price", updated } }
      : undefined,
    stock: n.tracksInventory && n.totalInventory !== null && !sellsWhenOut ? { inStock: n.totalInventory > 0, source: { system: "shopify", ref: "inventory", updated } } : undefined,
    facts: parseFacts(n.facts?.value).map(f => ({
      ...f,
      source: { system: "shopify", ref: `metafield centurion.facts.${f.attribute}`, updated: n.facts?.updatedAt?.slice(0, 10) ?? updated }
    })),
    approvedClaims: parseClaims(n.approved?.value),
    prohibitedClaims: parseClaims(n.prohibited?.value)
  };
}

/**
 * The store's active products as a catalog. Products named in `bestSellers` (for example the AI Sales
 * report's top products) come first, in that order; the rest follow by most recently updated.
 */
export async function fetchShopCatalog(run: GraphqlRunner, opts: { bestSellers?: string[]; first?: number } = {}): Promise<Catalog> {
  const res = await run(CATALOG_QUERY, { first: opts.first ?? 25 });
  if (res.errors?.length) throw new Error(`Shopify catalog query failed: ${res.errors.map((e: { message: string }) => e.message).join("; ")}`);
  const nodes: ProductNode[] = res.data?.products?.nodes ?? [];
  const rank = new Map((opts.bestSellers ?? []).map((t, i) => [t.toLowerCase(), i]));
  const products = nodes
    .map(productFromNode)
    .map((p, i) => ({ p, i, r: rank.get(p.title.toLowerCase()) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.p);
  return {
    store: { name: res.data?.shop?.name ?? "Your store", domain: res.data?.shop?.myshopifyDomain ?? "" },
    demo: false,
    products,
    policies: []
  };
}
