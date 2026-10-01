"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { displayName, initials, type ConversationItem } from "./types";

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onNew,
  className,
}: {
  conversations: ConversationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  className?: string;
}) {
  const t = useTranslations("inboxOficial.inbox");
  const format = useFormatter();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((c) => displayName(c).toLowerCase().includes(term) || (c.waId ?? "").includes(term));
  }, [q, conversations]);

  return (
    <aside className={cn("w-full shrink-0 flex-col border-r border-border sm:w-80", className)}>
      <div className="flex items-center gap-2 border-b border-border p-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm focus-visible:border-brand focus-visible:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onNew}
          title={t("newConversation")}
          aria-label={t("newConversation")}
          className="flex size-9 items-center justify-center rounded-lg bg-brand text-brand-foreground hover:opacity-90"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="p-6 text-center text-sm text-muted-foreground">{t("noConversations")}</li>
        ) : (
          filtered.map((c) => {
            const name = displayName(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                    c.id === selectedId && "bg-brand/10",
                  )}
                >
                  <Avatar name={name} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{name}</span>
                      {c.lastMessageAt ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {format.dateTime(new Date(c.lastMessageAt), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{c.lastMessagePreview ?? ""}</span>
                      {c.unreadCount > 0 ? (
                        <span className="shrink-0 rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-foreground">
                          {c.unreadCount}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}
