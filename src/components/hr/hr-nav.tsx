"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/app/hr", key: "overview" },
  { href: "/app/hr/employees", key: "employees" },
  { href: "/app/hr/payroll", key: "payroll" },
  { href: "/app/hr/settings", key: "catalogs" },
] as const;

/** Header + tab bar shared across the HR screens (mirrors the finance nav). */
export function HrNav() {
  const t = useTranslations("hr");
  const pathname = usePathname();

  // Focused screens (employee record, a payroll run) get their own heading.
  if (pathname.startsWith("/app/hr/employees/") || pathname.startsWith("/app/hr/payroll/")) {
    return null;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((tab) => {
          const active =
            tab.href === "/app/hr" ? pathname === "/app/hr" : pathname.startsWith(tab.href);
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
