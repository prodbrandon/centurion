import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Assistant } from "@/components/Assistant";
import { Tabs } from "@/components/Tabs";
import { getAiSales } from "@/lib/data";
import { ASSISTANT_SUGGESTIONS } from "@centurion/core/server";
import "./globals.css";

const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Centurion",
  description: "See the sales AI sends your store, test whether AI agents can buy, and fix one thing a week."
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sales = await getAiSales();
  const storeName = sales.view?.store.name ?? (sales.mode === "live" ? sales.shop : "");

  return (
    <html lang="en" className={`${body.variable} ${mono.variable}`}>
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              Centurion<span>.</span>
            </Link>
            <span className="store-chip">
              {storeName} · {sales.mode === "demo" ? "demo store" : "live"}
            </span>
          </header>
          {sales.mode === "demo" ? (
            <p className="demo-banner">
              <b>Demo mode.</b> A fictional outdoor brand with 90 days of sample orders. Nothing here touches a real store.
            </p>
          ) : (
            <p className="demo-banner">
              <b>Live data.</b> The same report the Centurion Shopify app shows for {sales.shop}.
            </p>
          )}
          <Tabs />
          <Assistant suggestions={ASSISTANT_SUGGESTIONS} storeName={storeName} />
          <main>{children}</main>
          <footer className="foot">
            {sales.view
              ? `AI Sales numbers come from the Centurion engine (AI source list v${sales.view.signaturesVersion}). `
              : ""}
            Answer Check, Checkout Test and Weekly Fix label their demo, fixture and test-page data on each screen.
          </footer>
        </div>
      </body>
    </html>
  );
}
