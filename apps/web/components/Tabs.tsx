"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "AI Revenue", short: "Revenue" },
  { href: "/fix", label: "Fix AI Answers", short: "Fix" },
  { href: "/checkout-test", label: "Agent Checkout", short: "Checkout" }
];

export function Tabs() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Centurion features">
      {TABS.map(t => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}>
          <span className="tab-long">{t.label}</span>
          <span className="tab-short">{t.short}</span>
        </Link>
      ))}
    </nav>
  );
}
