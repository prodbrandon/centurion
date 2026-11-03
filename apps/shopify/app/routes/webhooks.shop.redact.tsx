import type { ActionFunctionArgs } from "react-router";
import { deleteShopData, getDb } from "@centurion/core/server";
import { authenticate } from "../shopify.server";

// Mandatory compliance webhook, sent 48 hours after uninstall: delete everything for the shop.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const db = getDb();
  if (db) await deleteShopData(db, shop);
  console.log(`Received ${topic} webhook for ${shop}: shop data deleted`);
  return new Response();
};
