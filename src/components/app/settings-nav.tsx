"use client";

import { useTranslations } from "next-intl";
import { LayoutGrid, UserRound, Users, ShieldCheck, ScrollText, CreditCard } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/app/settings", key: "overview", icon: LayoutGrid, admin: false },
  { href: "/app/settings/profile", key: "profile", icon: UserRound, admin: false },
  { href: "/app/settings/team", key: "team", icon: Users, admin: false },
  { href: "/app/settings/billing", key: "billing", icon: CreditCard, admin: false },
  { href: "/app/settings/access", key: "access", icon: ShieldCheck, admin: true },
  { href: "/app/settings/audit", key: "audit", icon: ScrollText, admin: true },
] as const;

/** Shared tab bar across all Settings screens. Admin-only tabs are hidden for
 * members. Mirrors the HR/finance section navs. */
export function SettingsNav({ canAdmin }: { canAdmin: boolean }) {
  const t = useTranslations("settings.nav");
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.filter((tab) => !tab.admin || canAdmin).map((tab) => {
        const active =
          tab.href === "/app/settings" ? pathname === "/app/settings" : pathname.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-brand font-medium text-brand"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
