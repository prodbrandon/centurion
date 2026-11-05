// Live demo writes: applies the Northpine demo fix to a real (development) Shopify store. The dev store doesn't
// sell Northpine products, so the fixed product is created there on first use, by title, then the fix goes
// through the same applyFix/undoFix as the Weekly Fix screen (read back after write, undo refuses on conflict).
import type { GraphqlRunner } from "../../attribution/src/shopify.ts";
import type { CatalogProduct } from "./answer-check/types.ts";
import { getShopifyToken, normalizeShopDomain } from "./shopify-auth.ts";
import { applyFix, shopifyProductAdmin, storeWritesEnabled, undoFix, type FixSuggestion } from "./weekly-fix.ts";

export type Env = Record<string, string | undefined>;

/** Live demo writes need a store (SHOPIFY_*) and CENTURION_STORE_WRITES=on. */
export const liveStoreWrites = (env: Env = process.env) =>
  storeWritesEnabled(env) && Boolean(env.SHOPIFY_SHOP && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET);

/** An Admin API runner for SHOPIFY_SHOP using the client credentials grant (no merchant session needed). */
export function clientCredentialsRunner(env: Env = process.env): GraphqlRunner {
  const domain = normalizeShopDomain(env.SHOPIFY_SHOP ?? "");
  const version = env.SHOPIFY_API_VERSION || "2026-10";
  return async (query, variables) => {
    const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await getShopifyToken({ shop: domain }) },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000)
    });
    if (res.status === 401 || res.status === 403) throw new Error(`Shopify returned HTTP ${res.status}. The app needs the write_products scope on ${domain}.`);
    if (!res.ok) throw new Error(`Shopify returned HTTP ${res.status}.`);
    return (await res.json()) as { data?: any; errors?: { message: string }[] };
  };
}

const gidNumber = (gid: string) => gid.split("/").pop() ?? "";

/** Finds the demo product on the store by exact title, or creates it (active, Northpine as vendor). Returns its GID. */
export async function ensureDemoProduct(run: GraphqlRunner, product: CatalogProduct): Promise<{ id: string; created: boolean }> {
  const found = await run(`query CenturionFind($q: String!) { products(first: 5, query: $q) { nodes { id title } } }`, {
    q: `title:"${product.title.replace(/"/g, "")}"`
  });
  if (found.errors?.length) throw new Error(`Shopify product search failed: ${found.errors.map(e => e.message).join("; ")}`);
  const hit = (found.data?.products?.nodes ?? []).find((n: { title: string }) => n.title === product.title);
  if (hit) return { id: hit.id, created: false };
  const made = await run(
    `mutation CenturionSeed($product: ProductCreateInput!) { productCreate(product: $product) { product { id } userErrors { field message } } }`,
    {
      product: {
        title: product.title,
        descriptionHtml: `<p>${(product.description ?? "").replace(/</g, "&lt;")}</p>`,
        vendor: "Northpine Outfitters",
        productType: "Demo",
        tags: ["centurion-demo"],
        status: "ACTIVE"
      }
    }
  );
  const errors = [...(made.errors ?? []).map(e => e.message), ...(made.data?.productCreate?.userErrors ?? []).map((e: { message: string }) => e.message)];
  if (errors.length) throw new Error(`Couldn't create the demo product: ${errors.join("; ")}`);
  return { id: made.data.productCreate.product.id, created: true };
}

export interface LiveFixResult {
  productId: string;
  adminUrl: string;
  createdProduct: boolean;
  beforeHtml: string;
  afterHtml: string;
}

/** Applies the fix to the store's copy of the product (creating it first if needed). */
export async function applyFixLive(run: GraphqlRunner, shop: string, s: FixSuggestion, product: CatalogProduct, env: Env = process.env): Promise<LiveFixResult> {
  const { id, created } = await ensureDemoProduct(run, product);
  const applied = await applyFix(shopifyProductAdmin(run), { ...s, productId: id }, { writesEnabled: storeWritesEnabled(env) });
  const handle = normalizeShopDomain(shop).replace(/\.myshopify\.com$/, "");
  return {
    productId: id,
    adminUrl: `https://admin.shopify.com/store/${handle}/products/${gidNumber(id)}`,
    createdProduct: created,
    beforeHtml: applied.beforeHtml,
    afterHtml: applied.afterHtml
  };
}

/** Restores the description from before the fix, unless it was edited since. */
export async function undoFixLive(run: GraphqlRunner, input: { productId: string; suggestion: FixSuggestion; beforeHtml: string; afterHtml: string }, env: Env = process.env) {
  return undoFix(shopifyProductAdmin(run), { suggestion: { ...input.suggestion, productId: input.productId }, beforeHtml: input.beforeHtml, afterHtml: input.afterHtml }, { writesEnabled: storeWritesEnabled(env) });
}
