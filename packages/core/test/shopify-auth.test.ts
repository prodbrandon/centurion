// Client credentials token exchange: request shape, caching, refresh before expiry, and error messages.
// Uses a mocked fetch; no network.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createShopifyAuth, normalizeShopDomain, type ShopifyAuthEnv } from "../src/server.ts";

const SECRET = "fake-secret-7f3c9a1e-do-not-leak";
const ENV: ShopifyAuthEnv = { SHOPIFY_SHOP: "demo-store", SHOPIFY_CLIENT_ID: "client-123", SHOPIFY_CLIENT_SECRET: SECRET };

interface Call {
  url: string;
  init: RequestInit;
}

function mockFetch(respond: (n: number) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const { status, body } = respond(calls.length);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const ok = (token: string, expiresIn = 86399) => ({ status: 200, body: { access_token: token, scope: "read_orders", expires_in: expiresIn } });

test("first call exchanges the client credentials for a token", async () => {
  const { fetch, calls } = mockFetch(() => ok("token-1"));
  const auth = createShopifyAuth({ fetch, env: ENV, now: () => 0 });

  assert.equal(await auth.getToken(), "token-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://demo-store.myshopify.com/admin/oauth/access_token");
  assert.equal(calls[0]!.init.method, "POST");
  const form = new URLSearchParams(String(calls[0]!.init.body));
  assert.equal(form.get("grant_type"), "client_credentials");
  assert.equal(form.get("client_id"), "client-123");
  assert.equal(form.get("client_secret"), SECRET);
});

test("a second call reuses the cached token", async () => {
  const { fetch, calls } = mockFetch(n => ok(`token-${n}`));
  const auth = createShopifyAuth({ fetch, env: ENV, now: () => 0 });

  assert.equal(await auth.getToken(), "token-1");
  assert.equal(await auth.getToken(), "token-1");
  assert.equal(calls.length, 1);
});

test("a token inside the 60 second refresh window is replaced", async () => {
  let now = 0;
  const { fetch, calls } = mockFetch(n => ok(`token-${n}`, 3600));
  const auth = createShopifyAuth({ fetch, env: ENV, now: () => now });

  assert.equal(await auth.getToken(), "token-1");
  now = (3600 - 61) * 1000;
  assert.equal(await auth.getToken(), "token-1");
  now = (3600 - 59) * 1000;
  assert.equal(await auth.getToken(), "token-2");
  assert.equal(calls.length, 2);
});

test("concurrent callers share one token request", async () => {
  const { fetch, calls } = mockFetch(n => ok(`token-${n}`));
  const auth = createShopifyAuth({ fetch, env: ENV, now: () => 0 });

  const tokens = await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);
  assert.deepEqual(tokens, ["token-1", "token-1", "token-1"]);
  assert.equal(calls.length, 1);
});

test("the shop may be given as a handle or a myshopify.com domain, and they share a cache entry", async () => {
  const { fetch, calls } = mockFetch(n => ok(`token-${n}`));
  const auth = createShopifyAuth({ fetch, env: { ...ENV, SHOPIFY_SHOP: "demo-store.myshopify.com" }, now: () => 0 });

  assert.equal(await auth.getToken(), "token-1");
  assert.equal(await auth.getToken({ shop: "demo-store" }), "token-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://demo-store.myshopify.com/admin/oauth/access_token");
  assert.equal(normalizeShopDomain("https://Demo-Store.myshopify.com/"), "demo-store.myshopify.com");
  assert.throws(() => normalizeShopDomain("evil.example.com/x"), /SHOPIFY_SHOP/);
});

test("a non-200 response gives the status and a hint, without the secret", async () => {
  const { fetch } = mockFetch(() => ({ status: 401, body: { error: "invalid_client", error_description: `Client authentication failed for ${SECRET}` } }));
  const auth = createShopifyAuth({ fetch, env: ENV, now: () => 0 });

  const err = await auth.getToken().then(
    () => assert.fail("expected an error"),
    (e: Error) => e
  );
  assert.match(err.message, /HTTP 401/);
  assert.match(err.message, /invalid_client/);
  assert.match(err.message, /SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET/);
  assert.ok(!err.message.includes(SECRET), "error message must not contain the client secret");
});

test("a long error description that echoes the secret across the length cut leaks no part of it", async () => {
  const description = `${"x".repeat(290)}${SECRET} trailing text`;
  const { fetch } = mockFetch(() => ({ status: 400, body: { error: "invalid_request", error_description: description } }));
  const err = await createShopifyAuth({ fetch, env: ENV, now: () => 0 })
    .getToken()
    .then(
      () => assert.fail("expected an error"),
      (e: Error) => e
    );
  assert.ok(!err.message.includes(SECRET.slice(0, 6)), "no prefix of the secret survives trimming");
});

test("shop_not_permitted explains that the app and store must share an organization", async () => {
  const { fetch } = mockFetch(() => ({
    status: 400,
    body: { error: "shop_not_permitted", error_description: "Client credentials cannot be performed on this shop." }
  }));
  const auth = createShopifyAuth({ fetch, env: ENV, now: () => 0 });

  await assert.rejects(auth.getToken(), (e: Error) => {
    assert.match(e.message, /HTTP 400 \(shop_not_permitted\)/);
    assert.match(e.message, /same Shopify organization/);
    assert.ok(!e.message.includes(SECRET));
    return true;
  });
});

test("a 200 without an access_token is an error and is not cached", async () => {
  const { fetch, calls } = mockFetch(n => (n === 1 ? { status: 200, body: { scope: "read_orders" } } : ok("token-2")));
  const auth = createShopifyAuth({ fetch, env: ENV, now: () => 0 });

  await assert.rejects(auth.getToken(), /without an access_token/);
  assert.equal(await auth.getToken(), "token-2");
  assert.equal(calls.length, 2);
});

test("missing environment variables fail before any request", async () => {
  const { fetch, calls } = mockFetch(() => ok("unused"));

  await assert.rejects(createShopifyAuth({ fetch, env: {} }).getToken(), (e: Error) => {
    assert.match(e.message, /SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET/);
    return true;
  });
  await assert.rejects(createShopifyAuth({ fetch, env: { ...ENV, SHOPIFY_CLIENT_SECRET: "" } }).getToken(), (e: Error) => {
    assert.match(e.message, /SHOPIFY_CLIENT_SECRET/);
    assert.doesNotMatch(e.message, /SHOPIFY_SHOP|SHOPIFY_CLIENT_ID/);
    return true;
  });
  assert.equal(calls.length, 0);
});
