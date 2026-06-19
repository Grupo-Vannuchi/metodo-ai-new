"use client";

import { useEffect, useState } from "react";
import { Bell, Clock, CheckSquare, AlertTriangle, Wallet, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Alerts = {
  total: number;
  tasksOverdue: number;
  tasksToday: number;
  staleOpps: number;
  financeOverdue: number;
  unread: number;
};

const POLL_MS = 30000;

/** Notification bell with derived alerts (polled). Each row links to the
 * relevant screen. A lightweight "command center" — no persisted table yet. */
export function NotificationBell({
  className,
  align = "right",
}: {
  className?: string;
  /** Which edge the dropdown anchors to. "left" opens toward the right (use in
   * the narrow sidebar); "right" opens toward the left (use in the mobile bar). */
  align?: "left" | "right";
}) {
  const t = useTranslations("notifications");
  const [a, setA] = useState<Alerts | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const r = await fetch("/api/notifications", { cache: "no-store" });
        if (active && r.ok) setA(await r.json());
      } catch {
        /* ignore */
      }
    };
    void load();
    const i = setInterval(() => void load(), POLL_MS);
    return () => {
      active = false;
      clearInterval(i);
    };
  }, []);

  const total = a?.total ?? 0;
  const rows = a
    ? (
        [
          { key: "tasksOverdue", icon: Clock, count: a.tasksOverdue, href: "/app/tasks", danger: true },
          { key: "tasksToday", icon: CheckSquare, count: a.tasksToday, href: "/app/tasks", danger: false },
          { key: "staleOpps", icon: AlertTriangle, count: a.staleOpps, href: "/app/crm", danger: false },
          { key: "financeOverdue", icon: Wallet, count: a.financeOverdue, href: "/app/finance/entries", danger: true },
          { key: "unread", icon: MessageCircle, count: a.unread, href: "/app/inbox", danger: false },
        ] as const
      ).filter((r) => r.count > 0)
    : [];

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
            <div className="border-b border-border px-4 py-2.5 text-sm font-semibold">{t("title")}</div>
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {rows.map((r) => (
                  <li key={r.key}>
                    <Link
                      href={r.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted"
                    >
                      <r.icon className={cn("size-4 shrink-0", r.danger ? "text-red-500" : "text-muted-foreground")} />
                      <span className="flex-1">{t(r.key)}</span>
                      <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">{r.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
