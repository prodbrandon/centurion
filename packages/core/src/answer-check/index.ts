export * from "./types.ts";
export { DEMO_NORTHPINE_CATALOG } from "./demo-catalog.ts";
export { DEMO_FIXTURE_ANSWERS } from "./demo-fixtures.ts";
export { buildQuestions } from "./questions.ts";
export { compareAnswer, extractQuantities, sourceText, type Comparison, type Quantity } from "./compare.ts";
export {
  createAnswerProviders,
  fixtureProvider,
  isMetaLive,
  metaLiveProvider,
  readMetaAnswer,
  META_DEFAULT_BASE_URL,
  META_DEFAULT_MODEL,
  META_LABEL,
  META_MAX_COMPLETION_TOKENS,
  NoFixtureError,
  ProviderError,
  type AnswerProvider,
  type ProviderEnv
} from "./providers.ts";
export { findings, runAnswerCheck } from "./run.ts";
export { fetchShopCatalog, parseClaims, parseFacts, productFromNode, CATALOG_QUERY } from "./shopify-catalog.ts";
