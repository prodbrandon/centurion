// DEMO fixture answers for the fictional Northpine Outfitters catalog (demo-catalog.ts), keyed by
// question id. These are written samples, not model output: they stand in for each provider until
// its API key exists, and every screen that shows them says so. Some are deliberately wrong so the
// comparison has something to catch.
import type { ProviderId } from "./types.ts";

export const DEMO_FIXTURE_ANSWERS: Record<ProviderId, Record<string, string>> = {
  meta: {
    "NP-TH2:overview": "The Trailhead 2 Down Jacket is a packable 800-fill down jacket from Northpine Outfitters. It weighs about 410 g in a men's medium and is rated comfortable to -12 °C when layered.",
    "NP-TH2:fill_power": "It uses 800-fill responsibly sourced down.",
    "NP-TH2:water_resistance": "Yes, the Trailhead 2 is fully waterproof, so it's a good pick for heavy rain.",
    "NP-TH2:comfort_rating": "Northpine rates it comfortable down to about -12 °C when worn with layers underneath.",
    "NP-TH2:weight": "A men's medium weighs around 410 grams.",
    "NP-TH2:price": "The Trailhead 2 Down Jacket sells for $229.",
    "NP-RB45:overview": "The Ridgeback 45L is a 45-liter pack with an adjustable torso from 16 to 21 inches. It weighs about 1.3 kg.",
    "NP-RB45:volume": "It holds 45 liters.",
    "NP-RB45:torso_fit": "The torso adjusts from 16 to 21 inches.",
    "NP-RB45:weight": "The Ridgeback 45L weighs about 1.3 kg.",
    "NP-RB45:price": "It costs $189.",
    "NP-RB45:stock": "Yes, it is currently in stock on the Northpine site.",
    "NP-CM2:overview": "The Cedar Merino Base Layer is made from 100% 200gsm merino wool and is machine washable.",
    "NP-CM2:material": "It is 100% merino wool, 200gsm.",
    "NP-CM2:care": "I don't have information about the care instructions for that product.",
    "NP-CM2:price": "The Cedar Merino Base Layer is $89.",
    "NP-CM2:stock": "Yes, it's in stock and ready to ship.",
    "policy:returns": "Northpine accepts returns of unworn items within 60 days of delivery for a full refund, and return shipping is free for loyalty members.",
    "policy:shipping": "Standard shipping is free on US orders over $75 and takes 3 to 5 business days.",
    "policy:warranty": "Northpine outerwear has a 2-year warranty against manufacturing defects."
  },
  openai: {
    "NP-TH2:water_resistance": "It's water resistant, not waterproof: the DWR-coated shell handles light rain and snow.",
    "NP-RB45:weight": "It's an ultralight pack at about 0.9 kg.",
    "NP-CM2:material": "It's made of 100% merino wool.",
    "policy:returns": "You can return unworn items within 30 days."
  },
  perplexity: {
    "NP-TH2:price": "The Trailhead 2 is listed at $229.",
    "NP-CM2:overview": "The Cedar is a merino wool base layer. Yes, it's antibacterial and odor-proof, so you can wear it for days.",
    "policy:shipping": "Northpine ships free on US orders over $75; delivery usually takes 3 to 5 business days."
  },
  gemini: {
    "NP-TH2:price": "The Trailhead 2 Down Jacket costs $199.",
    "NP-RB45:volume": "The Ridgeback holds 45 liters.",
    "policy:warranty": "Jackets come with a 2-year warranty against defects."
  }
};
