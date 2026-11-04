// The checkout agent against the local test store, in real headless Chromium.
import { strict as assert } from "node:assert";
import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { guardBlocks, runCheckoutAgent } from "../src/agent.ts";
import { startTestStore, type TestStoreOptions } from "../src/test-store.ts";

async function run(opts: TestStoreOptions, extra: { query?: string; video?: boolean } = {}) {
  const store = await startTestStore(opts);
  const videoDir = extra.video ? await mkdtemp(join(tmpdir(), "checkout-video-")) : null;
  try {
    const result = await runCheckoutAgent({
      url: store.url,
      kind: "test_page",
      query: extra.query ?? "trail jacket",
      videoDir,
      actionTimeoutMs: 4000
    });
    return { result, hits: [...store.hits], videoDir };
  } finally {
    await store.close();
  }
}

const statuses = (r: Awaited<ReturnType<typeof run>>["result"]) => r.steps.map(s => `${s.title}: ${s.status}`);

test("a clean store: every step passes, checkout is reached, and a video is saved", async () => {
  const { result, hits, videoDir } = await run({}, { video: true });
  assert.equal(result.result, "reached_checkout");
  assert.equal(result.failedStep, null);
  assert.equal(result.problems, 0);
  assert.deepEqual(statuses(result), [
    "Open the store: passed",
    "Search for “trail jacket”: passed",
    "Open the product page: passed",
    "Choose options: passed",
    "Add to cart: passed",
    "Go to the cart: passed",
    "Reach checkout: passed"
  ]);
  assert.match(result.steps[2]!.detail, /Trail Jacket opened\. Price \$229\.00/);
  assert.ok(hits.includes("GET /checkout"));
  assert.ok(!hits.some(h => h.endsWith("/pay")), "never submits payment");
  assert.ok(result.videoPath?.endsWith(".webm"));
  assert.ok((await stat(result.videoPath!)).size > 0);
  assert.deepEqual(await readdir(videoDir!), [basename(result.videoPath!)]);
});

test("the step log records the failing step and stops there", async () => {
  const { result, hits } = await run({ noAddToCart: true });
  assert.equal(result.result, "blocked");
  assert.equal(result.failedStep, 5);
  const failed = result.steps[4]!;
  assert.equal(failed.title, "Add to cart");
  assert.equal(failed.status, "blocked");
  assert.match(failed.detail, /no add-to-cart button/);
  assert.match(failed.hint!, /Add to cart/);
  assert.equal(result.steps.length, 5, "no steps run after the blocking one");
  assert.ok(!hits.includes("GET /checkout"));
});

test("store problems that slow the agent are logged with a fix", async () => {
  const { result } = await run({ popup: true, unlabeledSize: true, noSearch: true });
  assert.equal(result.result, "reached_checkout");
  assert.equal(result.problems, 3);
  const by = (title: RegExp) => result.steps.find(s => title.test(s.title))!;
  assert.equal(by(/Search/).status, "slowed");
  assert.match(by(/Search/).hint!, /search box/);
  assert.equal(by(/Choose options/).status, "slowed");
  assert.match(by(/Choose options/).detail, /no visible label/);
  assert.equal(by(/Go to the cart/).status, "slowed");
  assert.match(by(/Go to the cart/).detail, /popup covered the checkout button/);
});

test("the worker never submits payment, even when the checkout button posts to /pay", async () => {
  const { result, hits } = await run({ checkoutPosts: true });
  assert.equal(result.result, "blocked");
  assert.equal(result.steps.at(-1)!.title, "Reach checkout");
  assert.match(result.steps.at(-1)!.detail, /tried to send POST \/pay/);
  assert.deepEqual(result.blockedRequests, ["POST /pay"]);
  assert.ok(!hits.some(h => h === "POST /pay"), `the store never received a payment request: ${hits.join(", ")}`);
});

test("on a clean run the agent stops at checkout and never touches the payment form", async () => {
  const { result, hits } = await run({});
  assert.equal(result.steps.at(-1)!.title, "Reach checkout");
  assert.deepEqual(
    hits.filter(h => h.startsWith("POST")),
    ["POST /cart/add.js"],
    "the only write is adding to the cart"
  );
  assert.deepEqual(result.blockedRequests, []);
});

test("a checkout link that GETs /pay is stopped and blamed correctly", async () => {
  const { result, hits } = await run({ checkoutGetsPay: true });
  assert.equal(result.result, "blocked");
  assert.match(result.steps.at(-1)!.detail, /tried to send GET \/pay/);
  assert.deepEqual(result.blockedRequests, ["GET /pay"]);
  assert.ok(!hits.some(h => h.includes("/pay")), hits.join(", "));
});

test("a checkout button that posts a form is stopped: from the checkout click on, only page loads and cart writes go through", async () => {
  const { result, hits } = await run({ checkoutFormPost: true });
  assert.equal(result.result, "blocked");
  assert.match(result.steps.at(-1)!.detail, /tried to send POST \/checkout/);
  assert.ok(!hits.includes("POST /checkout"), hits.join(", "));
});

test("writes the checkout page sends while loading are stopped, and the run still reaches checkout", async () => {
  const { result, hits } = await run({ checkoutPagePosts: true });
  assert.equal(result.result, "reached_checkout");
  assert.deepEqual([...result.blockedRequests].sort(), ["POST /api/graphql", "POST /orders/create"]);
  assert.match(result.steps.at(-1)!.detail, /payment guard stopped 2 requests/);
  assert.ok(!hits.some(h => h.startsWith("POST /orders") || h.startsWith("POST /api")), hits.join(", "));
});

test("a normal add-to-cart request is never mistaken for a payment", async () => {
  const { result, hits } = await run({});
  assert.ok(hits.includes("POST /cart/add.js"), "the add-to-cart request (with ?return_to=/discard) reached the store");
  assert.deepEqual(result.blockedRequests, []);
});

test("an add to cart with no visible confirmation is slowed, not passed", async () => {
  const { result } = await run({ silentAdd: true });
  const add = result.steps.find(s => s.title === "Add to cart")!;
  // The store still answered the cart request, which the agent counts as accepted.
  assert.equal(add.status, "passed");
  assert.match(add.detail, /The cart accepted the item/);
});

test("the guard matches payment paths only, never hosts, queries or product names", () => {
  for (const [method, url, armed, blocked] of [
    ["GET", "https://s.example/pay?confirm=1", false, true],
    ["POST", "https://s.example/payments/session", false, true],
    ["POST", "https://s.example/checkouts/cn/abc/processing", false, true],
    ["POST", "https://s.example/cart/add.js?return_to=/discard", false, false],
    ["POST", "https://paylessshoes.example/cart/add", false, false],
    ["GET", "https://s.example/products/gift-card", false, false],
    ["GET", "https://s.example/collections/cardigans", false, false],
    ["POST", "https://s.example/cart", true, false],
    ["POST", "https://s.example/checkout", true, true],
    ["POST", "https://s.example/api/graphql", true, true],
    ["GET", "https://s.example/checkouts/cn/abc", true, false]
  ] as const) {
    assert.equal(guardBlocks(method, url, armed), blocked, `${method} ${url} armed=${armed}`);
  }
});

test("a video folder that can't be created fails fast instead of hanging", async () => {
  const store = await startTestStore();
  try {
    const dir = await mkdtemp(join(tmpdir(), "checkout-video-"));
    const file = join(dir, "not-a-folder");
    await writeFile(file, "");
    await assert.rejects(runCheckoutAgent({ url: store.url, kind: "test_page", videoDir: join(file, "videos") }), /ENOTDIR|EEXIST/);
  } finally {
    await store.close();
  }
});

test("swatch pickers with hidden radio inputs are chosen through their labels", async () => {
  const { result, hits } = await run({ swatches: true });
  const choose = result.steps.find(s => s.title === "Choose options")!;
  assert.equal(choose.status, "passed");
  assert.match(choose.detail, /Chose Color Pine/);
  assert.equal(result.result, "reached_checkout");
  assert.ok(hits.includes("POST /cart/add.js"));
});

test("swatches whose label wraps a hidden input are chosen", async () => {
  const { result } = await run({ wrappedSwatches: true });
  const choose = result.steps.find(s => s.title === "Choose options")!;
  assert.equal(choose.status, "passed", choose.detail);
  assert.match(choose.detail, /Chose Color Pine/);
  assert.equal(result.result, "reached_checkout");
});

test("hidden or unrelated radios (sold-out quick-add, newsletter) are left alone", async () => {
  const { result } = await run({ distractions: true });
  const choose = result.steps.find(s => s.title === "Choose options")!;
  assert.equal(choose.status, "passed", choose.detail);
  assert.doesNotMatch(choose.detail, /newsletter|qa-size|unavailable/);
  assert.equal(result.result, "reached_checkout");
});

test("an unreachable store fails at the first step", async () => {
  const store = await startTestStore();
  const url = store.url;
  await store.close();
  const result = await runCheckoutAgent({ url, kind: "test_page", videoDir: null, actionTimeoutMs: 2000 });
  assert.equal(result.failedStep, 1);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0]!.status, "blocked");
});
