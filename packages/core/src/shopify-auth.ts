// Admin API access tokens for a store, from a Dev Dashboard app using the client credentials grant.
// The app and the store must belong to the same Shopify organization. Tokens last about 24 hours,
// so they are cached per shop and client id and refreshed shortly before they expire.
// No dependencies beyond global fetch: packages/attribution imports this file by relative path.

export type ShopifyAuthEnv = Record<string, string | undefined>;

export interface ShopifyAuthOptions {
  fetch?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
  /** Read on every call, so later changes to the environment are picked up. */
  env?: ShopifyAuthEnv;
}

export interface TokenRequest {
  /** Overrides SHOPIFY_SHOP. */
  shop?: string;
}

export interface ShopifyAuth {
  getToken(req?: TokenRequest): Promise<string>;
  clearCache(): void;
}

export class ShopifyAuthError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "ShopifyAuthError";
    this.status = status;
    this.code = code;
  }
}

/** Refresh when fewer than this many milliseconds remain before expiry. */
export const REFRESH_MARGIN_MS = 60_000;

/** Accepts `my-store` or `my-store.myshopify.com` (optionally with https://) and returns `my-store.myshopify.com`. */
export function normalizeShopDomain(shop: string): string {
  const handle = shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\.myshopify\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(handle)) {
    throw new ShopifyAuthError(`SHOPIFY_SHOP must be a store handle like "my-store" or "my-store.myshopify.com", got "${shop}".`);
  }
  return `${handle}.myshopify.com`;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
  errors?: unknown;
}

const HINTS: Record<string, string> = {
  shop_not_permitted:
    "The client credentials grant only works when the app and the store are in the same Shopify organization. Check that the store is listed under the app's organization in the Dev Dashboard.",
  invalid_client: "Check SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET."
};

function describeFailure(status: number, body: TokenResponse | null, secret: string): ShopifyAuthError {
  // Shopify does not echo credentials, but never let one reach a log through an error message.
  // Redact before trimming, so a cut can't leave part of the secret behind.
  const clean = (text: string) => (secret ? text.split(secret).join("[redacted]") : text);
  const code = typeof body?.error === "string" ? clean(body.error) : undefined;
  const rawDescription =
    typeof body?.error_description === "string" ? body.error_description : typeof body?.errors === "string" ? body.errors : undefined;
  const description = rawDescription === undefined ? undefined : clean(rawDescription);
  let message = `Shopify token request failed with HTTP ${status}`;
  if (code) message += ` (${code})`;
  if (description) message += `: ${description.slice(0, 300)}`;
  message += ".";
  const hint = (code && HINTS[code]) ?? (status === 401 ? HINTS.invalid_client : undefined);
  if (hint) message += ` ${hint}`;
  return new ShopifyAuthError(message, status, code);
}

export function createShopifyAuth(opts: ShopifyAuthOptions = {}): ShopifyAuth {
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const now = opts.now ?? Date.now;
  const cache = new Map<string, CachedToken>();
  const inflight = new Map<string, Promise<string>>();

  async function request(key: string, domain: string, clientId: string, secret: string): Promise<string> {
    const res = await doFetch(`https://${domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: secret }).toString(),
      signal: AbortSignal.timeout(30_000)
    });
    let body: TokenResponse | null = null;
    try {
      body = (await res.json()) as TokenResponse;
    } catch {
      body = null;
    }
    if (res.status !== 200) throw describeFailure(res.status, body, secret);
    if (typeof body?.access_token !== "string" || body.access_token === "") {
      throw new ShopifyAuthError(`Shopify token request for ${domain} returned HTTP 200 without an access_token.`, 200);
    }
    const expiresIn = Number(body.expires_in);
    // Without a usable lifetime the token is used for this request only.
    if (Number.isFinite(expiresIn) && expiresIn > 0) cache.set(key, { token: body.access_token, expiresAt: now() + expiresIn * 1000 });
    else cache.delete(key);
    return body.access_token;
  }

  return {
    async getToken(req: TokenRequest = {}) {
      const env = opts.env ?? process.env;
      const shop = req.shop ?? env.SHOPIFY_SHOP;
      const clientId = env.SHOPIFY_CLIENT_ID;
      const secret = env.SHOPIFY_CLIENT_SECRET;
      const missing = [!shop && "SHOPIFY_SHOP", !clientId && "SHOPIFY_CLIENT_ID", !secret && "SHOPIFY_CLIENT_SECRET"].filter(Boolean);
      if (missing.length) throw new ShopifyAuthError(`Missing environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);

      const domain = normalizeShopDomain(shop!);
      const key = `${domain}\n${clientId}`;
      const cached = cache.get(key);
      if (cached && cached.expiresAt - now() > REFRESH_MARGIN_MS) return cached.token;

      const pending = inflight.get(key);
      if (pending) return pending;
      const next = request(key, domain, clientId!, secret!).finally(() => inflight.delete(key));
      inflight.set(key, next);
      return next;
    },
    clearCache() {
      cache.clear();
      inflight.clear();
    }
  };
}

const shared = createShopifyAuth();

/** Returns a valid Admin API access token for SHOPIFY_SHOP (or `req.shop`), fetching or refreshing it as needed. */
export function getShopifyToken(req?: TokenRequest): Promise<string> {
  return shared.getToken(req);
}

/** Drops cached tokens held by getShopifyToken. */
export function clearShopifyTokenCache(): void {
  shared.clearCache();
}
