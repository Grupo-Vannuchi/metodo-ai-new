"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/app/finance", key: "overview" },
  { href: "/app/finance/entries", key: "entries" },
  { href: "/app/finance/cashflow", key: "cashflow" },
  { href: "/app/finance/dre", key: "dre" },
] as const;

/** Header + tab bar shared across the finance screens. */
export function FinanceNav() {
  const t = useTranslations("finance");
  const pathname = usePathname();

  // Focused form screens (create/edit entry) get their own heading instead of
  // the tab bar, so they read as a distinct screen.
  if (pathname.startsWith("/app/finance/entries/")) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((tab) => {
          const active =
            tab.href === "/app/finance"
              ? pathname === "/app/finance"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
                active
                  ? "border-brand font-medium text-brand"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`nav.${tab.key}`)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
