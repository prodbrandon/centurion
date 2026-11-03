// Agent Checkout Test worker. A scripted shopping agent opens a storefront in Chromium, finds a product,
// adds it to the cart and goes to checkout, then stops. It never pays: it never types into payment
// fields, it stops as soon as checkout loads, and a request guard aborts any non-GET request to a
// payment-like URL (and every non-GET request once checkout is reached), whatever the page does.
// Each step is logged as passed, slowed (the agent got through, with trouble) or blocked (it stopped).
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import type { CheckoutRunResult, CheckoutStep, CheckoutStepStatus } from "@centurion/core";

export const AGENT_LABEL = "Scripted shopping agent (Playwright, Chromium), no model";

/** Requests that look like they submit or authorize a payment. */
export const PAYMENT_URL = /pay|payment|charge|purchase|place[-_]?order|submit[-_]?order|complete[-_]?order|checkouts?\/.+\/(complete|processing)|card|wallet/i;

export interface CheckoutAgentOptions {
  url: string;
  /** What the shopper looks for. Default: the first product the agent finds. */
  query?: string;
  /** "test_page" for the local test store, "storefront" for a real store. Shown on every screen. */
  kind: CheckoutRunResult["target"]["kind"];
  /** Where to save the video. null: no video. */
  videoDir?: string | null;
  /** Milliseconds each browser action may wait. Default 8000. */
  actionTimeoutMs?: number;
  /** Injected for tests. Default: headless Chromium. */
  launch?: () => Promise<Browser>;
  now?: () => Date;
}

interface StepOutcome {
  status: CheckoutStepStatus;
  detail: string;
  hint?: string;
}

class Blocked extends Error {
  constructor(
    message: string,
    readonly hint?: string
  ) {
    super(message);
  }
}

const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 240);

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const c of candidates) {
    const n = await c.count();
    for (let i = 0; i < n; i++) {
      const el = c.nth(i);
      if (await el.isVisible().catch(() => false)) return el;
    }
  }
  return null;
}

const productLinks = (page: Page) => page.locator('a[href*="/products/"]');

/** True when nothing covers the element: a trial click fails when another element (a popup) intercepts it. */
async function clickable(el: Locator): Promise<boolean> {
  try {
    await el.click({ trial: true, timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function closeOverlay(page: Page): Promise<boolean> {
  const close = await firstVisible([
    page.locator('[role="dialog"], [aria-modal="true"], .modal, .popup').getByRole("button", { name: /close|dismiss|no thanks|×|✕/i }),
    page.getByRole("button", { name: /^(close|dismiss|no thanks|×|✕)$/i })
  ]);
  if (close) {
    await close.click();
    return true;
  }
  await page.keyboard.press("Escape");
  return false;
}

export async function runCheckoutAgent(opts: CheckoutAgentOptions): Promise<CheckoutRunResult> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now();
  const steps: CheckoutStep[] = [];
  const blockedRequests: string[] = [];
  let checkoutReached = false;

  const browser = await (opts.launch ?? (() => chromium.launch()))();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(opts.videoDir ? { recordVideo: { dir: opts.videoDir, size: { width: 1280, height: 800 } } } : {})
  });
  await context.route("**/*", route => {
    const req = route.request();
    const isWrite = req.method() !== "GET" && req.method() !== "HEAD";
    if (isWrite && (checkoutReached || PAYMENT_URL.test(req.url()))) {
      blockedRequests.push(`${req.method()} ${new URL(req.url()).pathname}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(opts.actionTimeoutMs ?? 8000);

  let stopped = false;
  const step = async (title: string, fn: () => Promise<StepOutcome>) => {
    if (stopped) return;
    const t0 = Date.now();
    let outcome: StepOutcome;
    try {
      outcome = await fn();
    } catch (error) {
      outcome = { status: "blocked", detail: firstLine(error), hint: error instanceof Blocked ? error.hint : undefined };
    }
    steps.push({ n: steps.length + 1, title, ...outcome, ms: Date.now() - t0, url: page.url() });
    if (outcome.status === "blocked") stopped = true;
  };

  const query = opts.query?.trim();

  await step("Open the store", async () => {
    const t0 = Date.now();
    const res = await page.goto(opts.url, { waitUntil: "domcontentloaded" });
    if (!res || !res.ok()) throw new Blocked(`The home page returned ${res?.status() ?? "no response"}.`);
    return { status: "passed", detail: `Home page loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s.` };
  });

  await step(query ? `Search for “${query}”` : "Find a product", async () => {
    const box = await firstVisible([page.getByRole("searchbox"), page.locator('input[type="search"], input[name="q"]')]);
    if (query && box) {
      await box.fill(query);
      await Promise.all([page.waitForLoadState("domcontentloaded"), box.press("Enter")]);
      await page.waitForLoadState("domcontentloaded");
      if ((await productLinks(page).count()) > 0) {
        const title = (await productLinks(page).first().innerText()).split("·")[0]!.trim();
        return { status: "passed", detail: `${title} was the first result.` };
      }
      await page.goto(opts.url, { waitUntil: "domcontentloaded" });
      if ((await productLinks(page).count()) === 0) throw new Blocked("Search found nothing and the home page lists no products.", "Make sure search returns products for plain words.");
      return { status: "slowed", detail: "Search returned no products, so the agent browsed the home page instead.", hint: "Make sure search returns products for plain words." };
    }
    if ((await productLinks(page).count()) === 0) throw new Blocked("No search box and no product links on the home page.", "Link to products from the home page and add a visible search box.");
    if (query && !box) {
      return { status: "slowed", detail: "No search box, so the agent browsed the home page instead.", hint: "Add a visible search box. Agents use it first." };
    }
    return { status: "passed", detail: "Found products on the home page." };
  });

  await step("Open the product page", async () => {
    const links = productLinks(page);
    const words = (query ?? "").toLowerCase().split(/\s+/).filter(w => w.length > 2);
    let target = links.first();
    for (let i = 0; i < (await links.count()); i++) {
      const text = (await links.nth(i).innerText()).toLowerCase();
      if (words.some(w => text.includes(w))) {
        target = links.nth(i);
        break;
      }
    }
    await Promise.all([page.waitForLoadState("domcontentloaded"), target.click()]);
    await page.waitForURL(/\/products\//);
    const text = await page.locator("body").innerText();
    const title = (await page.locator("h1").first().innerText().catch(() => "")).trim() || "The product";
    const price = text.match(/[$€£]\s?\d[\d,]*(?:\.\d{2})?/)?.[0];
    if (!price) return { status: "slowed", detail: `${title} opened, but the agent couldn't find a price.`, hint: "Show the price as text near the title." };
    return { status: "passed", detail: `${title} opened. Price ${price} was readable.` };
  });

  await step("Choose options", async () => {
    const selects = page.locator("main select, form select, select");
    const n = await selects.count();
    if (n === 0) return { status: "passed", detail: "No options to choose." };
    const unlabeled: string[] = [];
    const chosen: string[] = [];
    for (let i = 0; i < n; i++) {
      const sel = selects.nth(i);
      if (!(await sel.isVisible())) continue;
      const info = await sel.evaluate((el: HTMLSelectElement) => ({
        name: el.labels?.[0]?.textContent?.trim() || el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") ? "labelled" : ""),
        id: el.name || el.id || "option",
        options: [...el.options].filter(o => o.value !== "" && !o.disabled).map(o => o.value)
      }));
      if (info.options.length === 0) throw new Blocked(`The ${info.name || info.id} picker has no options available.`, "Check the product has an option in stock.");
      if (!info.name) unlabeled.push(info.id);
      const pick = info.options[Math.min(1, info.options.length - 1)]!;
      await sel.selectOption(pick);
      chosen.push(`${info.name || info.id} ${pick}`);
    }
    if (unlabeled.length > 0) {
      return {
        status: "slowed",
        detail: `Chose ${chosen.join(", ")}. The ${unlabeled.join(", ")} picker has no visible label, so the agent had to guess what it was.`,
        hint: `Add a visible label to the ${unlabeled.join(", ")} picker.`
      };
    }
    return { status: "passed", detail: chosen.length ? `Chose ${chosen.join(", ")}.` : "No options to choose." };
  });

  await step("Add to cart", async () => {
    const add = await firstVisible([
      page.getByRole("button", { name: /add to (cart|bag|basket)/i }),
      page.locator('input[type="submit"][value*="Add" i], button[name="add"]')
    ]);
    if (!add) throw new Blocked("There is no add-to-cart button on the product page.", "Show an “Add to cart” button on every product page.");
    if (!(await clickable(add))) await closeOverlay(page);
    await add.click();
    await page.waitForTimeout(400);
    const status = (await page.locator('[role="status"], [role="alert"]').allInnerTexts().catch(() => [] as string[])).join(" ");
    if (/choose|select|required|sold out|unavailable/i.test(status)) throw new Blocked(`The store refused: “${status.trim()}”.`, "Make the error say which option is missing, next to the button.");
    const said = status.trim().replace(/[.!]+$/, "");
    return { status: "passed", detail: said ? `Clicked “Add to cart”. The store said “${said}”.` : "Clicked “Add to cart”." };
  });

  await step("Go to the cart", async () => {
    const link = await firstVisible([page.getByRole("link", { name: /cart|bag|basket/i }), page.locator('a[href$="/cart"]')]);
    if (link) await Promise.all([page.waitForLoadState("domcontentloaded"), link.click()]);
    else await page.goto(new URL("/cart", opts.url).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/cart/);
    const checkout = await firstVisible([page.getByRole("link", { name: /check ?out/i }), page.getByRole("button", { name: /check ?out/i })]);
    if (!checkout) throw new Blocked("The cart page has no checkout button.", "Show a “Check out” button on the cart page.");
    if (await clickable(checkout)) return { status: "passed", detail: "Cart loaded with a checkout button." };
    const closedWithButton = await closeOverlay(page);
    if (await clickable(checkout)) {
      return {
        status: "slowed",
        detail: `A popup covered the checkout button. The agent ${closedWithButton ? "found its close button" : "dismissed it with Escape"}. Many agents give up here.`,
        hint: "Don’t show popups on cart and checkout pages."
      };
    }
    throw new Blocked("A popup covers the checkout button and the agent couldn't close it.", "Don’t show popups on cart and checkout pages.");
  });

  await step("Reach checkout", async () => {
    const checkout = await firstVisible([page.getByRole("link", { name: /check ?out/i }), page.getByRole("button", { name: /check ?out/i })]);
    if (!checkout) throw new Blocked("The checkout button disappeared.");
    await checkout.click();
    try {
      await page.waitForURL(/\/checkouts?(\/|$|\?)/, { timeout: opts.actionTimeoutMs ?? 8000 });
    } catch {
      if (blockedRequests.length > 0) {
        throw new Blocked(`The checkout button tried to submit a payment request (${blockedRequests[0]}), so the agent stopped it.`, "The checkout button should open checkout, not submit an order.");
      }
      throw new Blocked("Checkout did not open after clicking the checkout button.");
    }
    checkoutReached = true;
    return { status: "passed", detail: "Checkout page loaded. The agent stopped before payment, as it always does." };
  });

  const video = page.video();
  await context.close();
  await browser.close();

  let videoPath: string | null = null;
  if (video && opts.videoDir) {
    await mkdir(opts.videoDir, { recursive: true });
    const raw = await video.path();
    videoPath = join(opts.videoDir, `checkout-${startedAt.toISOString().replace(/[:.]/g, "-")}.webm`);
    await rename(raw, videoPath);
  }

  const failed = steps.find(s => s.status === "blocked");
  const finishedAt = now();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    target: { url: opts.url, kind: opts.kind },
    agent: AGENT_LABEL,
    query: query ?? null,
    result: failed ? "blocked" : "reached_checkout",
    failedStep: failed ? failed.n : null,
    problems: steps.filter(s => s.status !== "passed").length,
    steps,
    videoPath,
    blockedRequests
  };
}
