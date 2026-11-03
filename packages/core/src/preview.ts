// Sample results for features that are not built yet (Answer Check and Checkout Test now run for real). Every screen that uses these
// says "Preview", in both the web app and the Shopify app. Catalog facts and policies come
// from the Northpine rulebook (apps/gateway/data/rulebook.json) so the
// comparisons are consistent. Replace each export with real data as the feature ships.

export const weeklyFix = {
  title: "Clear up the “waterproof” mix-up on the Trailhead 2 Down Jacket",
  product: "Trailhead 2 Down Jacket",
  field: "Product description, first line",
  before: "Our warmest packable jacket, ready for any weather.",
  after: "Water resistant, not waterproof: a DWR-coated shell that handles light rain and snow. 800-fill down, warm to −12 °C when layered.",
  holdouts: ["Ridgeback 45L Pack", "Cedar Merino Base Layer"]
};
