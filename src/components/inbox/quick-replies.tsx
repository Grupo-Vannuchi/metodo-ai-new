"use client";

import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { QuickReply } from "@/lib/queries/quick-replies";

/**
 * Canned-reply picker for the composer. Opens upward (it sits at the bottom of
 * the thread), lists the WhatsApp templates, and hands the chosen body up for
 * insertion. Placeholders like {nome} / {primeiro_nome} are resolved by the
 * caller against the open conversation.
 */
export function QuickReplies({ replies, onPick }: { replies: QuickReply[]; onPick: (body: string) => void }) {
  const t = useTranslations("inbox");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("quickReplies.button")}
        title={t("quickReplies.button")}
        className="inline-flex size-10 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Zap className="size-4" />
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-xl border border-border bg-card p-2 shadow-lg">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{t("quickReplies.title")}</p>
          {replies.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t("quickReplies.empty")}{" "}
              <Link href="/app/campaigns/templates" className="text-brand underline underline-offset-2">
                {t("quickReplies.manage")}
              </Link>
            </p>
          ) : (
            <div className="flex max-h-64 flex-col overflow-y-auto">
              {replies.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    onPick(r.body);
                    setOpen(false);
                  }}
                  className="flex flex-col gap-0.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{r.body}</span>
                </button>
              ))}
              <Link
                href="/app/campaigns/templates"
                className="mt-1 border-t border-border px-2 pt-2 text-xs text-brand hover:underline"
              >
                {t("quickReplies.manage")}
              </Link>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
