// Sample results for features that are not built yet. Every screen that uses these
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

export type Severity = "high" | "medium";

export const answerCheck = {
  date: "2026-10-24",
  asked: 15,
  matched: 11,
  findings: [
    {
      severity: "high",
      product: "Trailhead 2 Down Jacket",
      question: "Is the Northpine Trailhead 2 jacket waterproof?",
      said: "Yes, it’s fully waterproof, so it’s a good pick for heavy rain.",
      truth: "DWR-coated shell, handles light rain and snow; not waterproof.",
      source: "TH2 Lab Results p.2 (Notion), updated Jul 18",
      why: "“Waterproof” is a claim you’ve banned for this product. Shoppers who buy it for heavy rain are likely to return it."
    },
    {
      severity: "high",
      product: "Ridgeback 45L Pack",
      question: "How much does the Ridgeback 45L weigh?",
      said: "It’s an ultralight pack at about 0.9 kg.",
      truth: "1.3 kg.",
      source: "Shopify metafield specs.weight, updated May 10",
      why: "Wrong weight, plus “ultralight” is a banned claim for this pack."
    },
    {
      severity: "medium",
      product: "Returns policy",
      question: "What is Northpine’s return policy?",
      said: "You can return unworn items within 30 days.",
      truth: "Unworn items can be returned within 60 days of delivery for a full refund. Free return shipping for loyalty members.",
      source: "Help center: returns (Gorgias), updated Mar 2",
      why: "AI is underselling you. A 60-day window is a reason to buy."
    },
    {
      severity: "medium",
      product: "Cedar Merino Base Layer",
      question: "Does the Cedar merino base layer stop odor?",
      said: "Yes, it’s antibacterial and odor-proof.",
      truth: "100% 200gsm merino wool. No odor or antibacterial claims are approved.",
      source: "Shopify metafield specs.material",
      why: "“Odor-proof” and “antibacterial” are banned claims for this product."
    }
  ] satisfies { severity: Severity; product: string; question: string; said: string; truth: string; source: string; why: string }[]
};

export const weeklyFix = {
  title: "Clear up the “waterproof” mix-up on the Trailhead 2 Down Jacket",
  product: "Trailhead 2 Down Jacket",
  field: "Product description, first line",
  before: "Our warmest packable jacket, ready for any weather.",
  after: "Water resistant, not waterproof: a DWR-coated shell that handles light rain and snow. 800-fill down, warm to −12 °C when layered.",
  holdouts: ["Ridgeback 45L Pack", "Cedar Merino Base Layer"]
};
