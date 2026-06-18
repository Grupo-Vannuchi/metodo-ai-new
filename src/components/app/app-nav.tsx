"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  KanbanSquare,
  Radar,
  Send,
  MessageCircle,
  Building2,
  Contact,
  Cable,
  Settings,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type NavKey =
  | "dashboard"
  | "crm"
  | "prospecting"
  | "campaigns"
  | "inbox"
  | "companies"
  | "contacts"
  | "connections"
  | "settings";
type Item = { href: string; key: NavKey; icon: typeof LayoutDashboard };

const items: Item[] = [
  { href: "/app", key: "dashboard", icon: LayoutDashboard },
  { href: "/app/crm", key: "crm", icon: KanbanSquare },
  { href: "/app/prospecting", key: "prospecting", icon: Radar },
  { href: "/app/campaigns", key: "campaigns", icon: Send },
  { href: "/app/inbox", key: "inbox", icon: MessageCircle },
  { href: "/app/companies", key: "companies", icon: Building2 },
  { href: "/app/contacts", key: "contacts", icon: Contact },
  { href: "/app/connections", key: "connections", icon: Cable },
  { href: "/app/settings", key: "settings", icon: Settings },
];

/** Screens that are never gated by access templates. */
const ALWAYS_SHOWN: NavKey[] = ["dashboard", "settings"];

export function AppNav({ allowedScreens }: { allowedScreens: string[] }) {
  const t = useTranslations("app.nav");
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  const visible = items.filter(
    (i) => ALWAYS_SHOWN.includes(i.key) || allowedScreens.includes(i.key),
  );

  // Live unread badge for the inbox item (polled).
  useEffect(() => {
    if (!allowedScreens.includes("inbox")) return;
    let active = true;
    const load = async () => {
      try {
        const r = await fetch("/api/inbox/unread", { cache: "no-store" });
        if (active && r.ok) setUnread((await r.json()).count ?? 0);
      } catch {
        /* ignore */
      }
    };
    void load();
    const i = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(i);
    };
  }, [allowedScreens]);

  return (
    <nav className="flex flex-col gap-1">
      {visible.map(({ href, key, icon: Icon }) => {
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
            <span className="flex-1">{t(key)}</span>
            {key === "inbox" && unread > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-medium text-brand-foreground">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
