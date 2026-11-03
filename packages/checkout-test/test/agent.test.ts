// The checkout agent against the local test store, in real headless Chromium.
import { strict as assert } from "node:assert";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCheckoutAgent } from "../src/agent.ts";
import { startTestStore, type TestStoreOptions } from "../src/test-store.ts";

async function run(opts: TestStoreOptions, extra: { query?: string; video?: boolean } = {}) {
  const store = await startTestStore(opts);
  const videoDir = extra.video ? await mkdtemp(join(tmpdir(), "checkout-video-")) : null;
  try {
    const result = await runCheckoutAgent({ url: store.url, kind: "test_page", query: extra.query ?? "trail jacket", videoDir, actionTimeoutMs: 4000 });
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
  assert.deepEqual(await readdir(videoDir!), [result.videoPath!.split("/").pop()]);
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
  assert.match(result.steps.at(-1)!.detail, /tried to submit a payment request \(POST \/pay\)/);
  assert.deepEqual(result.blockedRequests, ["POST /pay"]);
  assert.ok(!hits.some(h => h === "POST /pay"), `the store never received a payment request: ${hits.join(", ")}`);
});

test("on a clean run the agent stops at checkout and never touches the payment form", async () => {
  const { result, hits } = await run({});
  assert.equal(result.steps.at(-1)!.title, "Reach checkout");
  assert.equal(hits.filter(h => h.startsWith("POST")).length, 0);
  assert.deepEqual(result.blockedRequests, []);
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
