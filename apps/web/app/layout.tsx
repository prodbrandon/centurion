import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { Tabs } from "@/components/Tabs";
import { getAiSales } from "@/lib/data";
import "./globals.css";

const body = DM_Sans({ subsets: ["latin"], variable: "--font-body" });
const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Centurion",
  description: "See the sales AI sends your store, test whether AI agents can buy, and fix one thing a week."
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sales = await getAiSales();
  const storeName = sales.view?.store.name ?? (sales.mode === "live" ? sales.shop : "");

  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
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
