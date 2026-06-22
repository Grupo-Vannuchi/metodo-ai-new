"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Clock, CheckSquare, AlertTriangle, Wallet, MessageCircle, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { clearNotifications, markNotificationRead } from "@/app/actions/notifications";
import { useRealtime } from "@/components/app/realtime-provider";

type Item = {
  id: string;
  type: string;
  data: { count?: number; actor?: string; title?: string } | null;
  link: string | null;
  createdAt: string;
};
type Payload = { total: number; items: Item[] };

const ICONS: Record<string, typeof Bell> = {
  TASK_OVERDUE: Clock,
  TASK_TODAY: CheckSquare,
  OPP_STALE: AlertTriangle,
  FINANCE_OVERDUE: Wallet,
  INBOX_UNREAD: MessageCircle,
  TASK_ASSIGNED: UserPlus,
  OPP_ASSIGNED: UserPlus,
};
const ASSIGN_TYPES = new Set(["TASK_ASSIGNED", "OPP_ASSIGNED"]);

/** Notification bell: polls the persisted notifications and localizes each one
 * from its `type` + `data` payload. Each edge anchors the dropdown differently. */
export function NotificationBell({
  className,
  align = "right",
}: {
  className?: string;
  /** "left" opens toward the right (narrow sidebar); "right" toward the left (mobile bar). */
  align?: "left" | "right";
}) {
  const t = useTranslations("notifications");
  const [a, setA] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (r.ok) setA(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  // Initial load (inline so the setState stays clearly behind the await).
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const r = await fetch("/api/notifications", { cache: "no-store" });
        if (active && r.ok) setA(await r.json());
      } catch {
        /* ignore */
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  // Pushed live by the realtime stream (no polling).
  useRealtime("notifications", load);

  const total = a?.total ?? 0;
  const items = a?.items ?? [];

  function handleClear() {
    setA((prev) => (prev ? { total: 0, items: [] } : null));
    void clearNotifications();
  }

  function handleOpenItem(id: string) {
    setOpen(false);
    setA((prev) => (prev ? { total: Math.max(0, prev.total - 1), items: prev.items.filter((i) => i.id !== id) } : null));
    void markNotificationRead(id);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("title")}
        className={cn("relative rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
      >
        <Bell className="size-5" />
        {total > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-foreground">
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div
            className={cn(
              "absolute z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-card shadow-xl motion-safe:animate-dialog-in",
              align === "left" ? "left-0" : "right-0",
            )}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-sm font-semibold">{t("title")}</span>
              {items.length > 0 ? (
                <button type="button" onClick={handleClear} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                  {t("clear")}
                </button>
              ) : null}
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {items.map((item) => {
                  const Icon = ICONS[item.type] ?? Bell;
                  const isAssign = ASSIGN_TYPES.has(item.type);
                  const label = t(`kind.${item.type}`, {
                    count: item.data?.count ?? 0,
                    actor: item.data?.actor ?? "",
                  });
                  const body = (
                    <>
                      <Icon className={cn("mt-0.5 size-4 shrink-0", isAssign ? "text-brand" : "text-muted-foreground")} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{label}</span>
                        {isAssign && item.data?.title ? (
                          <span className="block truncate text-xs text-muted-foreground">{item.data.title}</span>
                        ) : null}
                      </span>
                    </>
                  );
                  return (
                    <li key={item.id}>
                      {item.link ? (
                        <Link
                          href={item.link}
                          onClick={() => handleOpenItem(item.id)}
                          className="flex items-start gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted"
                        >
                          {body}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenItem(item.id)}
                          className="flex w-full items-start gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-muted"
                        >
                          {body}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
