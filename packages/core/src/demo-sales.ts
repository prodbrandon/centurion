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
      "units": 66,
      "revenue": 23034
    },
    {
      "title": "Ridgeback 45L Pack",
      "units": 87,
      "revenue": 16443
    },
    {
      "title": "Trailhead 2 Down Jacket",
      "units": 62,
      "revenue": 14198
    },
    {
      "title": "Switchback Trail Runner",
      "units": 72,
      "revenue": 10008
    },
    {
      "title": "Ultralight 1P Tent",
      "units": 20,
      "revenue": 7480
    },
    {
      "title": "Ridgeline Tarp",
      "units": 18,
      "revenue": 5112
    },
    {
      "title": "Cedar Merino Base Layer",
      "units": 55,
      "revenue": 4895
    },
    {
      "title": "Featherlite Quilt",
      "units": 22,
      "revenue": 3960
    },
    {
      "title": "Basecamp 3P Tent",
      "units": 24,
      "revenue": 3936
    },
    {
      "title": "Alpenglow Fleece",
      "units": 16,
      "revenue": 3584
    }
  ]
};
