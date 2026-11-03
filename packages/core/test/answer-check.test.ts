// AI Answer Check: deterministic comparison, provider switching (mocked fetch, no network),
// error handling, the fixture run on the demo catalog, and storage on PGlite.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  buildQuestions,
  compareAnswer,
  createAnswerProviders,
  deleteShopData,
  DEMO_NORTHPINE_CATALOG as CATALOG,
  extractQuantities,
  fetchShopCatalog,
  findings,
  fixtureProvider,
  loadLatestAnswerCheck,
  META_DEFAULT_MODEL,
  parseClaims,
  parseFacts,
  runAnswerCheck,
  saveAnswerCheck,
  type AnswerProvider,
  type Question,
  type Queryable
} from "../src/server.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const questions = buildQuestions(CATALOG);
const q = (id: string): Question => {
  const found = questions.find(x => x.id === id);
  assert.ok(found, `question ${id} exists`);
  return found;
};

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

test("flags a banned claim", () => {
  const r = compareAnswer("Yes, it's fully waterproof, so it's great for heavy rain.", q("NP-TH2:water_resistance"), CATALOG);
  assert.equal(r.status, "contradiction");
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0]!.kind, "banned_claim");
  assert.equal(r.issues[0]!.severity, "high");
  assert.match(r.issues[0]!.truth, /not waterproof/);
  assert.match(r.issues[0]!.source, /TH2 Lab Results p\.2 \(Notion\)/);
});

test("flags a wrong number even when the unit differs, and a banned claim in the same answer", () => {
  const r = compareAnswer("It's an ultralight pack at about 900 grams.", q("NP-RB45:weight"), CATALOG);
  assert.equal(r.status, "contradiction");
  assert.deepEqual(r.issues.map(i => i.kind).sort(), ["banned_claim", "wrong_fact"]);
  const fact = r.issues.find(i => i.kind === "wrong_fact")!;
  assert.equal(fact.truth, "1.3 kg");
  assert.match(fact.why, /900 grams/);
});

test("passes a correct answer, including a negated banned claim", () => {
  for (const [id, answer] of [
    ["NP-TH2:water_resistance", "It's water resistant, not waterproof: the DWR shell handles light rain and snow."],
    ["NP-TH2:water_resistance", "No. It isn't fully waterproof."],
    ["NP-RB45:weight", "About 1.3 kilograms, or roughly 2.9 lbs."],
    ["NP-TH2:comfort_rating", "Comfortable to about 10 °F when layered."],
    ["NP-TH2:price", "It costs $229."],
    ["policy:shipping", "Free shipping on US orders over $75, delivered in 3-5 business days."],
    ["policy:warranty", "There's a 2-year warranty on outerwear."]
  ] as const) {
    const r = compareAnswer(answer, q(id), CATALOG);
    assert.equal(r.status, "consistent", `${id}: ${answer} -> ${JSON.stringify(r.issues)}`);
  }
});

test("two banned claims in one sentence are one finding that names both", () => {
  const r = compareAnswer("Yes, it's antibacterial and odor-proof.", q("NP-CM2:overview"), CATALOG);
  assert.equal(r.issues.length, 1);
  assert.match(r.issues[0]!.why, /“odor-proof” and “antibacterial” are claims you’ve banned/);
});

test("a comma ends a negation: 'No, it's fully waterproof' is still a banned claim", () => {
  assert.equal(compareAnswer("No, it's fully waterproof.", q("NP-TH2:water_resistance"), CATALOG).status, "contradiction");
});

test("flags wrong prices only on price questions, wrong policies and wrong stock", () => {
  assert.equal(compareAnswer("The Trailhead 2 costs $199.", q("NP-TH2:price"), CATALOG).issues[0]!.kind, "wrong_price");
  // A shipping threshold in a product answer is not a price claim.
  assert.equal(compareAnswer("It's 800-fill down, and shipping is free over $75.", q("NP-TH2:overview"), CATALOG).status, "consistent");
  const returns = compareAnswer("You can return unworn items within 30 days.", q("policy:returns"), CATALOG);
  assert.equal(returns.issues[0]!.kind, "wrong_policy");
  assert.equal(returns.issues[0]!.severity, "medium");
  const stock = compareAnswer("Yes, it's in stock and ready to ship.", q("NP-CM2:stock"), CATALOG);
  assert.equal(stock.issues[0]!.kind, "wrong_stock");
  assert.equal(compareAnswer("Sorry, it's not in stock right now.", q("NP-CM2:stock"), CATALOG).status, "consistent");
});

test("an 'I don't know' answer is reported as no answer, not as a match", () => {
  assert.equal(compareAnswer("I don't have information about that product.", q("NP-CM2:care"), CATALOG).status, "no_answer");
});

test("quantity extraction normalizes units and reads ranges", () => {
  const qs = extractQuantities("Weighs 0.9 kg, holds 45L, fits 16 to 21 inches, 2-year warranty, -12 °C, $189, 200gsm, 800-fill, 12 in stock, 2 in 1");
  const by = (d: string) => qs.filter(x => x.dimension === d).map(x => Math.round(x.value * 10) / 10);
  assert.deepEqual(by("mass"), [900]);
  assert.deepEqual(by("volume"), [45]);
  assert.deepEqual(by("length"), [406.4, 533.4]);
  assert.deepEqual(by("duration"), [730]);
  assert.deepEqual(by("temperature"), [-12]);
  assert.deepEqual(by("money"), [189]);
});

// Regressions found in review: each case below was a wrong verdict before.
test("restock talk is not a stock claim", () => {
  for (const a of ["It's sold out right now, but it should be back in stock next week.", "Once it's in stock again it ships in a day."]) {
    assert.equal(compareAnswer(a, q("NP-CM2:stock"), CATALOG).status, "consistent", a);
  }
});

test("counts are not lengths", () => {
  assert.equal(compareAnswer("Yes, there are 12 in stock.", q("NP-RB45:stock"), CATALOG).status, "consistent");
  assert.deepEqual(extractQuantities("a 2 in 1 design"), []);
});

test("numbers are judged only against the fact their clause talks about", () => {
  for (const [id, a] of [
    ["NP-RB45:weight", "It weighs 1.3 kg and comfortably carries loads up to 15 kg."],
    ["NP-TH2:comfort_rating", "Comfortable to -12 C layered; machine wash at 30 C."],
    ["policy:returns", "Returns are accepted within 60 days; refunds post in 5-7 business days."],
    ["NP-TH2:weight", "It weighs 410 grams, roughly 1 lb."]
  ] as const) {
    const r = compareAnswer(a, q(id), CATALOG);
    assert.equal(r.status, "consistent", `${a} -> ${JSON.stringify(r.issues)}`);
  }
  // Still caught when the clause is about the fact.
  assert.equal(compareAnswer("It carries loads well and weighs just 0.9 kg.", q("NP-RB45:weight"), CATALOG).issues[0]!.kind, "wrong_fact");
});

test("a negator further back does not cancel a banned claim", () => {
  for (const a of ["It isn't just water-resistant but waterproof.", "There's no question it's waterproof.", "No leaks and fully waterproof."]) {
    const r = compareAnswer(a, q("NP-TH2:water_resistance"), CATALOG);
    assert.equal(r.issues[0]?.kind, "banned_claim", a);
  }
  assert.equal(compareAnswer("It is not 100% waterproof.", q("NP-TH2:water_resistance"), CATALOG).status, "consistent");
});

test("any option's price is right, and other currencies are shown as such", () => {
  const catalog = {
    ...CATALOG,
    products: [{ ...CATALOG.products[0]!, price: { amount: 199, max: 249, currency: "CAD", source: { system: "shopify", ref: "product price" } } }]
  };
  assert.equal(compareAnswer("The large size is 249 dollars.", q("NP-TH2:price"), catalog).status, "consistent");
  const wrong = compareAnswer("It costs $150.", q("NP-TH2:price"), catalog);
  assert.equal(wrong.issues[0]!.truth, "199 CAD to 249 CAD, depending on the option");
});

test("the comparison uses no model: compare.ts has no network or provider imports", () => {
  const src = readFileSync(resolve(here, "../src/answer-check/compare.ts"), "utf8");
  assert.doesNotMatch(src, /\bfetch\b|providers|import .* from "(?!\.\/types\.ts)/);
});

// ---------------------------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------------------------

function mockFetch(respond: () => { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const { status, body } = respond();
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const KEY = "LLM|fake-key-do-not-leak";
const llamaOk = (text: string) => ({ status: 200, body: { id: "x", completion_message: { role: "assistant", content: { type: "text", text }, stop_reason: "stop" } } });

test("without META_API_KEY every provider is a fixture and fetch is never called", async () => {
  const { fetch, calls } = mockFetch(() => llamaOk("unused"));
  for (const env of [{}, { META_API_KEY: "" }, { META_API_KEY: "   " }]) {
    const providers = createAnswerProviders(env, { fetch });
    assert.deepEqual(providers.map(p => [p.id, p.mode]), [["meta", "fixture"], ["openai", "fixture"], ["perplexity", "fixture"], ["gemini", "fixture"]]);
    await runAnswerCheck({ catalog: CATALOG, providers });
  }
  assert.equal(calls.length, 0);
});

test("with META_API_KEY the Meta provider is live and calls the Llama API", async () => {
  const { fetch, calls } = mockFetch(() => llamaOk("The Ridgeback 45L weighs about 1.3 kg."));
  const providers = createAnswerProviders({ META_API_KEY: KEY }, { fetch });
  assert.deepEqual(providers.map(p => [p.id, p.mode, p.model]), [["meta", "live", META_DEFAULT_MODEL]]);

  const answer = await providers[0]!.ask(q("NP-RB45:weight"), CATALOG);
  assert.equal(answer, "The Ridgeback 45L weighs about 1.3 kg.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.llama.com/v1/chat/completions");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  const body = JSON.parse(String(calls[0]!.init.body));
  assert.equal(body.model, META_DEFAULT_MODEL);
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[1].content, /How much does the Ridgeback 45L Pack weigh\?/);
});

test("META_MODEL and META_API_BASE_URL override the defaults, and OpenAI-style responses are read", async () => {
  const { fetch, calls } = mockFetch(() => ({ status: 200, body: { choices: [{ message: { role: "assistant", content: "It costs $189." } }] } }));
  const [meta] = createAnswerProviders({ META_API_KEY: KEY, META_MODEL: "Llama-3.3-70B-Instruct", META_API_BASE_URL: "https://api.llama.com/compat/v1/" }, { fetch });
  assert.equal(await meta!.ask(q("NP-RB45:price"), CATALOG), "It costs $189.");
  assert.equal(calls[0]!.url, "https://api.llama.com/compat/v1/chat/completions");
  assert.equal(JSON.parse(String(calls[0]!.init.body)).model, "Llama-3.3-70B-Instruct");
});

test("a model error marks that answer as an error and the run still finishes; the key never appears", async () => {
  let n = 0;
  const { fetch } = mockFetch(() => (++n === 2 ? { status: 500, body: { error: { message: "upstream overloaded" } } } : llamaOk("It costs $229.")));
  const providers = createAnswerProviders({ META_API_KEY: KEY }, { fetch });
  const qs = [q("NP-TH2:price"), q("NP-RB45:price"), q("NP-CM2:price")];
  const run = await runAnswerCheck({ catalog: CATALOG, providers, questions: qs, concurrency: 1 });

  assert.equal(run.mode, "live");
  assert.equal(run.asked, 3);
  assert.equal(run.errors, 1);
  const failed = run.results.find(r => r.status === "error")!;
  assert.equal(failed.questionId, "NP-RB45:price");
  assert.match(failed.error!, /returned 500: upstream overloaded/);
  // The other answers were still compared: $229 is right for the jacket, wrong for the base layer.
  assert.equal(run.results.find(r => r.questionId === "NP-TH2:price")!.status, "consistent");
  assert.equal(run.results.find(r => r.questionId === "NP-CM2:price")!.status, "contradiction");
  assert.ok(!JSON.stringify(run).includes(KEY));
});

test("network failures, timeouts and 401s become readable errors", async () => {
  const throwing = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof globalThis.fetch;
  const [offline] = createAnswerProviders({ META_API_KEY: KEY }, { fetch: throwing });
  const run = await runAnswerCheck({ catalog: CATALOG, providers: [offline!], questions: [q("NP-TH2:price")] });
  assert.equal(run.results[0]!.error, "The Llama API could not be reached.");

  const { fetch } = mockFetch(() => ({ status: 401, body: { detail: "invalid api key" } }));
  const [unauth] = createAnswerProviders({ META_API_KEY: KEY }, { fetch });
  await assert.rejects(unauth!.ask(q("NP-TH2:price"), CATALOG), /returned 401: invalid api key\. Check META_API_KEY\./);
});

// ---------------------------------------------------------------------------------------------
// The fixture run shown on both screens
// ---------------------------------------------------------------------------------------------

test("the demo fixture run is labeled fixture and catches the planted mistakes", async () => {
  const run = await runAnswerCheck({ catalog: CATALOG, providers: createAnswerProviders({}), now: new Date("2026-11-03T12:00:00Z") });
  assert.equal(run.mode, "fixture");
  assert.equal(run.demoCatalog, true);
  assert.ok(run.providers.every(p => p.mode === "fixture"));
  assert.equal(run.asked, 20 + 4 + 3 + 3);
  assert.equal(run.asked, run.consistent + run.contradictions + run.noAnswer + run.errors);
  const caught = findings(run).map(r => `${r.provider} ${r.questionId} ${r.issues.map(i => i.kind).join("+")}`);
  assert.deepEqual(caught, [
    "meta NP-TH2:water_resistance banned_claim",
    "openai NP-RB45:weight banned_claim+wrong_fact",
    "perplexity NP-CM2:overview banned_claim",
    "gemini NP-TH2:price wrong_price",
    "meta NP-CM2:stock wrong_stock",
    "openai policy:returns wrong_policy"
  ]);
  assert.equal(run.noAnswer, 1);
  assert.equal(run.errors, 0);
});

test("fixture providers skip questions they have no sample answer for", async () => {
  const run = await runAnswerCheck({ catalog: CATALOG, providers: [fixtureProvider("gemini")] });
  assert.equal(run.asked, 3);
});

test("questions are deterministic and ask about products before policies", () => {
  assert.deepEqual(buildQuestions(CATALOG), questions);
  assert.equal(questions[0]!.id, "NP-TH2:overview");
  assert.equal(questions.at(-1)!.id, "policy:warranty");
  assert.equal(questions.length, 20);
});

// ---------------------------------------------------------------------------------------------
// Shopify catalog and storage
// ---------------------------------------------------------------------------------------------

test("a Shopify catalog puts best sellers first and reads banned claims from metafields", async () => {
  const node = (id: string, title: string, inv: number, prohibited?: string, policy = "DENY") => ({
    id,
    title,
    updatedAt: "2026-11-01T00:00:00Z",
    tracksInventory: true,
    totalInventory: inv,
    priceRangeV2: { minVariantPrice: { amount: "49.0", currencyCode: "USD" } },
    prohibited: prohibited ? { value: prohibited } : null,
    approved: null,
    variants: { nodes: [{ inventoryPolicy: policy }] }
  });
  const run = async () => ({
    data: {
      shop: { name: "Dev Store", myshopifyDomain: "dev.myshopify.com" },
      products: { nodes: [node("gid://1", "Mug", 3), node("gid://2", "Snowboard", 0, '["waterproof","unbreakable"]'), node("gid://3", "Preorder Hat", 0, undefined, "CONTINUE")] }
    }
  });
  const catalog = await fetchShopCatalog(run, { bestSellers: ["Snowboard"] });
  assert.equal(catalog.demo, false);
  assert.deepEqual(catalog.products.map(p => p.title), ["Snowboard", "Mug", "Preorder Hat"]);
  assert.equal(catalog.products[2]!.stock, undefined, "continue-selling products are not judged on stock");
  assert.deepEqual(catalog.products[0]!.prohibitedClaims, ["waterproof", "unbreakable"]);
  assert.equal(catalog.products[0]!.stock!.inStock, false);
  assert.equal(catalog.products[1]!.price!.amount, 49);
  assert.deepEqual(parseClaims("odor-proof, antibacterial"), ["odor-proof", "antibacterial"]);
  assert.deepEqual(parseFacts('{"Weight": "1.3 kg", "torso fit": "16 to 21 inches", "bad": {}}'), [
    { attribute: "weight", value: "1.3 kg" },
    { attribute: "torso_fit", value: "16 to 21 inches" }
  ]);
  assert.deepEqual(parseFacts('[{"attribute":"material","value":"100% merino"}]'), [{ attribute: "material", value: "100% merino" }]);
  assert.deepEqual(parseFacts("not json"), []);
});

async function freshDb(): Promise<Queryable> {
  const pg = new PGlite();
  const dir = resolve(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(resolve(dir, f), "utf8"));
  return { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params as any[])).rows };
}

test("an Answer Check run round-trips through Postgres and is removed with the shop", async () => {
  const db = await freshDb();
  const shop = { domain: "dev.myshopify.com", name: "Dev Store" };
  assert.equal(await loadLatestAnswerCheck(db, shop.domain), null);

  const older = await runAnswerCheck({ catalog: CATALOG, providers: [fixtureProvider("gemini")], now: new Date("2026-11-01T00:00:00Z") });
  const newer = await runAnswerCheck({ catalog: CATALOG, providers: [fixtureProvider("openai")], now: new Date("2026-11-02T00:00:00Z") });
  await saveAnswerCheck(db, shop, older);
  await saveAnswerCheck(db, shop, newer);
  assert.deepEqual(await loadLatestAnswerCheck(db, shop.domain), newer);

  await deleteShopData(db, shop.domain);
  assert.equal(await loadLatestAnswerCheck(db, shop.domain), null);
  assert.equal(Number((await db.query<{ n: number }>("select count(*)::int as n from answer_checks"))[0]!.n), 0);
});

test("a provider that is neither live nor fixture is never reported as live", async () => {
  const live: AnswerProvider = { id: "meta", label: "Meta Llama", model: "m", mode: "live", ask: async () => "It costs $229." };
  const run = await runAnswerCheck({ catalog: CATALOG, providers: [live, fixtureProvider("gemini")], questions: [q("NP-TH2:price")] });
  assert.equal(run.mode, "fixture");
});
