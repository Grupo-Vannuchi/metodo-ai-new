"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  Star,
  Megaphone,
  KanbanSquare,
  CheckSquare,
  Radar,
  Send,
  MessageCircle,
  Building2,
  Contact,
  Cable,
  Wallet,
  Settings,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/components/app/realtime-provider";

type NavKey =
  | "dashboard"
  | "my"
  | "feed"
  | "crm"
  | "tasks"
  | "prospecting"
  | "campaigns"
  | "inbox"
  | "companies"
  | "contacts"
  | "connections"
  | "finance"
  | "settings";
type Item = { href: string; key: NavKey; icon: typeof LayoutDashboard };
type GroupKey = "general" | "crm" | "comms" | "finance" | "system";
type Group = { key: GroupKey; items: Item[] };

/** Nav items grouped into collapsible sections. */
const GROUPS: Group[] = [
  {
    key: "general",
    items: [
      { href: "/app", key: "dashboard", icon: LayoutDashboard },
      { href: "/app/my", key: "my", icon: Star },
      { href: "/app/feed", key: "feed", icon: Megaphone },
    ],
  },
  {
    key: "crm",
    items: [
      { href: "/app/crm", key: "crm", icon: KanbanSquare },
      { href: "/app/contacts", key: "contacts", icon: Contact },
      { href: "/app/companies", key: "companies", icon: Building2 },
      { href: "/app/tasks", key: "tasks", icon: CheckSquare },
    ],
  },
  {
    key: "comms",
    items: [
      { href: "/app/inbox", key: "inbox", icon: MessageCircle },
      { href: "/app/campaigns", key: "campaigns", icon: Send },
      { href: "/app/prospecting", key: "prospecting", icon: Radar },
    ],
  },
  {
    key: "finance",
    items: [{ href: "/app/finance", key: "finance", icon: Wallet }],
  },
  {
    key: "system",
    items: [
      { href: "/app/connections", key: "connections", icon: Cable },
      { href: "/app/settings", key: "settings", icon: Settings },
    ],
  },
];

/** Screens that are never gated by access templates. */
const ALWAYS_SHOWN: NavKey[] = ["dashboard", "my", "settings"];

export function AppNav({ allowedScreens }: { allowedScreens: string[] }) {
  const t = useTranslations("app.nav");
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [closed, setClosed] = useState<Set<GroupKey>>(new Set());

  const canShow = (key: NavKey) => ALWAYS_SHOWN.includes(key) || allowedScreens.includes(key);
  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  // Live unread badge for the inbox item — pushed by the realtime stream.
  const loadUnread = useCallback(async () => {
    if (!allowedScreens.includes("inbox")) return;
    try {
      const r = await fetch("/api/inbox/unread", { cache: "no-store" });
      if (r.ok) setUnread((await r.json()).count ?? 0);
    } catch {
      /* ignore */
    }
  }, [allowedScreens]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!allowedScreens.includes("inbox")) return;
      try {
        const r = await fetch("/api/inbox/unread", { cache: "no-store" });
        if (active && r.ok) setUnread((await r.json()).count ?? 0);
      } catch {
        /* ignore */
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [allowedScreens]);

  useRealtime("inbox", loadUnread);

  function toggleGroup(key: GroupKey) {
    setClosed((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  return (
    <nav className="flex flex-col gap-1">
      {GROUPS.map((group) => {
        const items = group.items.filter((i) => canShow(i.key));
        if (items.length === 0) return null;
        const isClosed = closed.has(group.key);
        const hasActive = items.some((i) => isActive(i.href));
        return (
          <div key={group.key} className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              aria-expanded={!isClosed}
              className={cn(
                "flex items-center gap-1 px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide transition-colors hover:text-foreground",
                isClosed && hasActive ? "text-brand" : "text-muted-foreground/60",
              )}
            >
              {isClosed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
              <span>{t(`group.${group.key}`)}</span>
            </button>
            {!isClosed
              ? items.map(({ href, key, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive(href)
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
                ))
              : null}
          </div>
        );
      })}
    </nav>
  );
}
