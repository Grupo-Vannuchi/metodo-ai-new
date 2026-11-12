"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Unread e-mails in the Microsoft Inbox, streamed in: the page passes the
 * pending count so a slow Microsoft never delays the page (wrap in Suspense).
 * Nothing shows at zero or when the count couldn't be read.
 */
export function UnreadBadge({ count, className }: { count: Promise<number | null>; className?: string }) {
  const t = useTranslations("emailBroadcast.inbox");
  const n = use(count);
  if (!n) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-semibold tabular-nums text-brand-foreground",
          className,
        )}
      >
        {n > 99 ? "99+" : n}
      </span>
      <span className="sr-only">{t("unreadCount", { count: n })}</span>
    </>
  );
}
