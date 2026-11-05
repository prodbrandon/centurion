// Builds the shopper questions for a catalog from fixed templates. Deterministic: the same catalog
// always gives the same questions, in the same order, with the same ids.
import type { Catalog, CatalogProduct, Question } from "./types.ts";

const FACT_QUESTIONS: Record<string, (title: string) => string> = {
  weight: t => `How much does the ${t} weigh?`,
  volume: t => `How many liters does the ${t} hold?`,
  material: t => `What is the ${t} made of?`,
  comfort_rating: t => `How warm is the ${t}?`,
  water_resistance: t => `Is the ${t} waterproof?`,
  fill_power: t => `What kind of down is in the ${t}?`,
  torso_fit: t => `What torso sizes does the ${t} fit?`,
  care: t => `How do I wash the ${t}?`
};

const POLICY_QUESTIONS: Record<string, (store: string) => string> = {
  returns: s => `What is ${s}'s return policy?`,
  shipping: s => `Does ${s} offer free shipping, and how long does delivery take?`,
  warranty: s => `What warranty does ${s} give on its jackets?`
};

function productQuestions(p: CatalogProduct, store: string): Question[] {
  const subject = { kind: "product" as const, id: p.id, title: p.title };
  // "The Hidden Snowboard" reads "the Hidden Snowboard" after "the", not "the The Hidden Snowboard".
  const t = p.title.replace(/^the\s+/i, "");
  const qs: Question[] = [{ id: `${p.id}:overview`, subject, focus: "overview", text: `What should I know about the ${t} from ${store} before I buy it?` }];
  for (const f of p.facts) {
    const template = FACT_QUESTIONS[f.attribute];
    if (template) qs.push({ id: `${p.id}:${f.attribute}`, subject, focus: f.attribute, text: template(t) });
  }
  if (p.price) qs.push({ id: `${p.id}:price`, subject, focus: "price", text: `How much does the ${t} cost?` });
  if (p.stock) qs.push({ id: `${p.id}:stock`, subject, focus: "stock", text: `Is the ${t} in stock right now?` });
  return qs;
}

/**
 * Questions shoppers ask about the given products (best sellers first, at most `maxProducts`) and the store's policies.
 * `maxPerProduct` keeps runs small on large catalogs; the overview question always comes first.
 */
export function buildQuestions(catalog: Catalog, opts: { maxProducts?: number; maxPerProduct?: number } = {}): Question[] {
  const store = catalog.store.name;
  const products = catalog.products.slice(0, opts.maxProducts ?? 5);
  const questions = products.flatMap(p => productQuestions(p, store).slice(0, opts.maxPerProduct ?? 6));
  for (const policy of catalog.policies) {
    const template = POLICY_QUESTIONS[policy.id];
    questions.push({
      id: `policy:${policy.id}`,
      subject: { kind: "policy", id: policy.id, title: `${policy.title} policy` },
      focus: "policy",
      text: template ? template(store) : `What is ${store}'s ${policy.title.toLowerCase()} policy?`
    });
  }
  return questions;
}
