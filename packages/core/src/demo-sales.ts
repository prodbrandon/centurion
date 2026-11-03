// DEMO AI Sales numbers for the fictional Northpine Outfitters store: the period and AI revenue per product
// from apps/web/data/demo.json (the engine's output on the sample orders). A test keeps the two identical.
// Used to show the Weekly Fix rule on demo data; never shown as a real store's numbers.
import type { SalesSnapshot } from "./weekly-fix.ts";

export const DEMO_SALES_SNAPSHOT: SalesSnapshot = {
  "period": {
    "from": "2026-07-25",
    "to": "2026-10-22"
  },
  "top_products": [
    {
      "title": "Basecamp 2P Tent",
      "units": 15,
      "revenue": 5235
    },
    {
      "title": "Ridgeback 45L Pack",
      "units": 26,
      "revenue": 4914
    },
    {
      "title": "Trailhead 2 Down Jacket",
      "units": 17,
      "revenue": 3893
    },
    {
      "title": "Switchback Trail Runner",
      "units": 19,
      "revenue": 2641
    },
    {
      "title": "Cedar Merino Base Layer",
      "units": 18,
      "revenue": 1602
    },
    {
      "title": "Summit Wool Beanie",
      "units": 18,
      "revenue": 576
    }
  ]
};
