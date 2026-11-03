"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "AI Sales", short: "AI Sales" },
  { href: "/checkout-test", label: "Checkout Test", short: "Checkout" },
  { href: "/answer-check", label: "Answer Check", short: "Answers" },
  { href: "/weekly-fix", label: "Weekly Fix", short: "Fix" }
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
