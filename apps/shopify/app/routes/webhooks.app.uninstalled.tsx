import type { ActionFunctionArgs } from "react-router";
import { getDb, markShopUninstalled } from "@centurion/core/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Hide Centurion data for this shop. It is deleted for good on shop/redact.
  const centurion = getDb();
  if (centurion) await markShopUninstalled(centurion, shop);

  return new Response();
};
