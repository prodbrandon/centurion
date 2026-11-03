// Sample results for features that are not built yet (Answer Check now runs for real: src/answer-check). Every screen that uses these
// says "Preview", in both the web app and the Shopify app. Catalog facts and policies come
// from the Northpine rulebook (apps/gateway/data/rulebook.json) so the
// comparisons are consistent. Replace each export with real data as the feature ships.

export type StepStatus = "passed" | "slowed" | "blocked";

export const checkoutRun = {
  date: "2026-10-24T15:10:00Z",
  agent: "Llama (vision), reading screenshots in desktop Chrome as an anonymous shopper",
  duration: "2 min 14 s",
  result: "Reached checkout in 7 steps. Stopped before payment.",
  problems: 2,
  steps: [
    { title: "Open the store", status: "passed", detail: "Home page loaded in 1.4 s." },
    { title: "Search for “warm packable jacket”", status: "passed", detail: "Trailhead 2 Down Jacket was the first result." },
    { title: "Open the product page", status: "passed", detail: "Price, photos and reviews were readable." },
    {
      title: "Choose size M",
      status: "slowed",
      detail: "The size picker has no visible label, so the agent guessed from the layout. It took 3 tries.",
      hint: "Add a visible “Size” label to the picker."
    },
    { title: "Add to cart", status: "passed", detail: "Cart updated to 1 item, $229." },
    {
      title: "Go to the cart",
      status: "blocked",
      detail: "A “Get 10% off” email popup covered the cart button. The agent closed it on the second try. Many agents give up here.",
      hint: "Don’t show the popup on cart and checkout pages, or delay it."
    },
    { title: "Reach checkout", status: "passed", detail: "Checkout page loaded. The agent stopped before payment, as it always does." }
  ] satisfies { title: string; status: StepStatus; detail: string; hint?: string }[]
};

export const weeklyFix = {
  title: "Clear up the “waterproof” mix-up on the Trailhead 2 Down Jacket",
  product: "Trailhead 2 Down Jacket",
  field: "Product description, first line",
  before: "Our warmest packable jacket, ready for any weather.",
  after: "Water resistant, not waterproof: a DWR-coated shell that handles light rain and snow. 800-fill down, warm to −12 °C when layered.",
  holdouts: ["Ridgeback 45L Pack", "Cedar Merino Base Layer"]
};
