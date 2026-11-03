import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Centurion</h1>
        <p className={styles.text}>
          See the sales AI is sending you, and make one small, proven improvement to your store every week.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>AI Sales</strong>. Orders that ChatGPT, Perplexity, Gemini and Copilot sent you, each with proof you can check.
          </li>
          <li>
            <strong>Agent Checkout Test</strong>. Watch an AI agent try to buy from your store, and see where it gets stuck.
          </li>
          <li>
            <strong>AI Answer Check and Weekly Fix</strong>. Where AI gets your products wrong, and one small fix a week, measured.
          </li>
        </ul>
      </div>
    </div>
  );
}
