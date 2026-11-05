// A small local storefront for developing and testing the checkout agent. It is a test page, not a
// real store: runs against it are labeled "test page" everywhere they are shown. Its flaws can be
// switched on to reproduce problems agents hit on real stores.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface TestStoreOptions {
  /** A discount popup covers the cart page (the agent has to close it). */
  popup?: boolean;
  /** The size picker has no label (agents have to guess what it is). */
  unlabeledSize?: boolean;
  /** The product page has no add-to-cart button. */
  noAddToCart?: boolean;
  /** No search box on the home page (the agent has to browse). */
  noSearch?: boolean;
  /** The cart's checkout button posts straight to /pay (a broken or hostile store). */
  checkoutPosts?: boolean;
  /** The cart's checkout link is a GET to /pay?confirm=1. */
  checkoutGetsPay?: boolean;
  /** The cart's checkout button is a form that posts to /checkout. */
  checkoutFormPost?: boolean;
  /** The checkout page sends POST /orders/create and POST /api/graphql while it loads. */
  checkoutPagePosts?: boolean;
  /** Add to cart shows no message and doesn't update the cart count. */
  silentAdd?: boolean;
  /** Color swatches (hidden radio inputs with clickable labels) instead of a size dropdown. */
  swatches?: boolean;
  /** Swatches whose label wraps a hidden input with no id. */
  wrappedSwatches?: boolean;
  /** Distractions: a hidden quick-add with sold-out radios, and a newsletter yes/no form. */
  distractions?: boolean;
}

export interface TestStore {
  url: string;
  /** Every request the store received, in order: "METHOD /path". */
  hits: string[];
  close(): Promise<void>;
}

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} · Test Store</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; color: #1d1d1f; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid #ddd; }
  main { padding: 24px; max-width: 720px; }
  .badge { background: #fde68a; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .product { display: block; padding: 12px; border: 1px solid #ddd; border-radius: 8px; margin: 8px 0; color: inherit; text-decoration: none; }
  button, .button { background: #1d1d1f; color: #fff; border: 0; padding: 10px 16px; border-radius: 6px; font-size: 15px; cursor: pointer; text-decoration: none; display: inline-block; }
  #popup { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; }
  #popup .box { background: #fff; padding: 32px; border-radius: 12px; width: 320px; text-align: center; }
  label, input, select { display: block; margin: 8px 0; font-size: 15px; }
</style></head>
<body><header><a href="/"><b>Test Store</b></a> <span class="badge">Test page, not a real store</span> <a href="/cart" id="cart-link">Cart (<span id="count">0</span>)</a></header>
<main>${body}</main>
<script>
  document.getElementById("count").textContent = Number(localStorage.getItem("cart") || 0);
</script></body></html>`;

const PRODUCTS = [
  { handle: "trail-jacket", title: "Trail Jacket", price: 229 },
  { handle: "day-pack", title: "Day Pack 25L", price: 89 }
];

const ADD_SCRIPT = `
  const size = document.getElementById("size");
  const msg = document.getElementById("msg");
  const color = document.querySelector("input[name=color]:checked");
  if (document.querySelector("input[name=color]") ? !color : !size.value) { msg.textContent = "Choose an option first."; return; }
  fetch("/cart/add.js?return_to=/discard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: 1, quantity: 1 }) })
    .then(r => r.json())
    .then(cart => {
      localStorage.setItem("cart", String(cart.item_count));
      if (SILENT) return;
      document.getElementById("count").textContent = localStorage.getItem("cart");
      msg.textContent = "Added to cart.";
    });`;

const CLOSE_POPUP = `document.getElementById("popup").style.display = "none";`;

function checkoutButton(opts: TestStoreOptions): string {
  if (opts.checkoutPosts) return `<form method="post" action="/pay"><button type="submit" id="checkout">Check out</button></form>`;
  if (opts.checkoutFormPost) return `<form method="post" action="/checkout"><button type="submit" id="checkout">Check out</button></form>`;
  if (opts.checkoutGetsPay) return `<a class="button" href="/pay?confirm=1" id="checkout">Check out</a>`;
  return `<a class="button" href="/checkout" id="checkout">Check out</a>`;
}

function render(path: string, query: URLSearchParams, opts: TestStoreOptions): string | null {
  if (path === "/") {
    const search = opts.noSearch
      ? ""
      : `<form action="/search" role="search"><label for="q">Search products</label><input id="q" name="q" type="search"><button type="submit">Search</button></form>`;
    const list = PRODUCTS.map(p => `<a class="product" href="/products/${p.handle}">${p.title} · $${p.price}</a>`).join("");
    return page("Home", `<h1>Test Store</h1>${search}<h2>Products</h2>${list}`);
  }
  if (path === "/search") {
    const q = (query.get("q") ?? "").toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const found = PRODUCTS.filter(p => words.some(w => p.title.toLowerCase().includes(w)));
    const list = found.map(p => `<a class="product" href="/products/${p.handle}">${p.title} · $${p.price}</a>`).join("") || "<p>No results.</p>";
    return page("Search", `<h1>Results for “${q.replace(/[<>&"]/g, "")}”</h1>${list}`);
  }
  const product = PRODUCTS.find(p => path === `/products/${p.handle}`);
  if (product) {
    const label = opts.unlabeledSize ? "" : `<label for="size">Size</label>`;
    const size = opts.wrappedSwatches
      ? `<fieldset><legend>Color</legend>${["Pine", "Slate"]
          .map(
            c =>
              `<label style="display:inline-block;padding:6px 12px;border:1px solid #999;margin:4px;cursor:pointer"><input type="radio" name="color" value="${c}" style="display:none">${c}</label>`
          )
          .join("")}</fieldset><input type="hidden" id="size" value="">`
      : opts.swatches
        ? `<fieldset><legend>Color</legend>${["Pine", "Slate", "Ember"]
            .map(
              c =>
                `<input type="radio" name="color" id="color-${c}" value="${c}" style="position:absolute;opacity:0;width:1px;height:1px"><label for="color-${c}" style="display:inline-block;padding:6px 12px;border:1px solid #999;border-radius:16px;margin:4px;cursor:pointer">${c}</label>`
            )
            .join("")}</fieldset><input type="hidden" id="size" value="">`
        : `${label}<select id="size" name="size"><option value="">Choose…</option><option>S</option><option>M</option><option>L</option></select>`;
    const add = opts.noAddToCart
      ? `<p>Available in stores.</p>`
      : `<button id="add" type="button" onclick='(function(){const SILENT=${opts.silentAdd ? "true" : "false"};${ADD_SCRIPT}})()'>Add to cart</button><p id="msg" role="status"></p>`;
    const distractions = opts.distractions
      ? `<div hidden><fieldset><legend>Size</legend><input type="radio" name="qa-size" value="S" disabled><input type="radio" name="qa-size" value="M" disabled></fieldset></div>
         <form action="/newsletter"><p>Get our newsletter?</p><input type="radio" name="newsletter" value="yes" id="nl-yes"><label for="nl-yes">Yes</label><input type="radio" name="newsletter" value="no" id="nl-no"><label for="nl-no">No</label></form>`
      : "";
    return page(product.title, `<h1>${product.title}</h1><p class="price">$${product.price}.00</p>${size}${add}${distractions}`);
  }
  if (path === "/cart") {
    const popup = opts.popup
      ? `<div id="popup" role="dialog" aria-label="Newsletter"><div class="box"><h2>Get 10% off</h2><input type="email" placeholder="Email"><button type="button">Join</button> <button type="button" aria-label="Close" onclick='${CLOSE_POPUP}'>×</button></div></div>`
      : "";
    return page(
      "Cart",
      `<h1>Your cart</h1><p id="lines"></p>${checkoutButton(opts)}${popup}
       <script>document.getElementById("lines").textContent = (localStorage.getItem("cart") || 0) + " item(s)";</script>`
    );
  }
  if (path === "/checkout") {
    return page(
      "Checkout",
      `<h1>Checkout</h1><form method="post" action="/pay">
        <label for="email">Email</label><input id="email" name="email" type="email">
        <label for="card">Card number</label><input id="card" name="card" autocomplete="cc-number">
        <label for="cvc">CVC</label><input id="cvc" name="cvc" autocomplete="cc-csc">
        <button type="submit" id="pay">Pay now</button></form>${
          opts.checkoutPagePosts
            ? `<script>fetch("/orders/create", { method: "POST" }).catch(() => {}); fetch("/api/graphql", { method: "POST", body: "{}" }).catch(() => {});</script>`
            : ""
        }`
    );
  }
  return null;
}

export async function startTestStore(opts: TestStoreOptions = {}): Promise<TestStore> {
  const hits: string[] = [];
  let cartCount = 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    hits.push(`${req.method} ${url.pathname}`);
    if (url.pathname === "/cart/add.js" && req.method === "POST") {
      cartCount++;
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ item_count: cartCount }));
      return;
    }
    if (url.pathname === "/pay") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page("Paid", "<h1>Payment submitted</h1>"));
      return;
    }
    const html = req.method === "GET" ? render(url.pathname, url.searchParams, opts) : null;
    res.writeHead(html ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" }).end(html ?? page("Not found", "<h1>Not found</h1>"));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}
