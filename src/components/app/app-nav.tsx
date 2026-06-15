"use client";

import {
  LayoutDashboard,
  KanbanSquare,
  Building2,
  Contact,
  Cable,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type NavKey = "dashboard" | "crm" | "companies" | "contacts" | "connections" | "team";
type Item = { href: string; key: NavKey; icon: typeof LayoutDashboard };

const items: Item[] = [
  { href: "/app", key: "dashboard", icon: LayoutDashboard },
  { href: "/app/crm", key: "crm", icon: KanbanSquare },
  { href: "/app/companies", key: "companies", icon: Building2 },
  { href: "/app/contacts", key: "contacts", icon: Contact },
  { href: "/app/connections", key: "connections", icon: Cable },
  { href: "/app/settings/team", key: "team", icon: Users },
];

export function AppNav() {
  const t = useTranslations("app.nav");
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {items.map(({ href, key, icon: Icon }) => {
        const active = href === "/app" ? pathname === "/app" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-brand/10 font-medium text-brand"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
