import type { ActionFunctionArgs } from "react-router";
import { getDb, redactOrders } from "@centurion/core/server";
import { authenticate } from "../shopify.server";

// Mandatory compliance webhook: delete the customer's orders and their attributions.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const orders = (payload as { orders_to_redact?: number[] }).orders_to_redact ?? [];
  const db = getDb();
  const removed = db ? await redactOrders(db, shop, orders) : 0;
  console.log(`Received ${topic} webhook for ${shop}: removed ${removed} of ${orders.length} orders`);
  return new Response();
};
