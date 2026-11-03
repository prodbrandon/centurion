import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Mandatory compliance webhook. Centurion stores trimmed orders (ids, totals, line items,
// visit sources) and no customer names, emails or addresses. Logged so the request can be
// answered from the orders table if a merchant forwards it.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const orders = (payload as { orders_requested?: number[] }).orders_requested ?? [];
  console.log(`Received ${topic} webhook for ${shop}: ${orders.length} orders requested`);
  return new Response();
};
