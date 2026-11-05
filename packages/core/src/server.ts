// Server-only exports: building the view with the engine, the Postgres store, and Shopify access tokens.
export * from "./index.ts";
export * from "./db.ts";
export { currentSignatures } from "./signatures.ts";
export { assembleView, buildView, canonicalOrders } from "./view.ts";
export { fetchOrdersWith, type GraphqlRunner } from "../../attribution/src/shopify.ts";
export * from "./shopify-auth.ts";
export type { Order, SignatureFile } from "../../attribution/src/types.ts";
export * from "./answer-check/index.ts";
export * from "./jobs.ts";
export * from "./weekly-fix.ts";
export { DEMO_SALES_SNAPSHOT } from "./demo-sales.ts";
export { askAssistant, askAssistantRich, parseRichReply, ACTIONS, DATASETS, type AssistantReply, type ChartData, storeBriefing, ASSISTANT_SUGGESTIONS, ASSISTANT_SYSTEM_PROMPT, type AssistantContext, type AssistantTurn } from "./assistant.ts";
export { applyFixLive, clientCredentialsRunner, ensureDemoProduct, liveStoreWrites, undoFixLive, type LiveFixResult } from "./demo-store.ts";
