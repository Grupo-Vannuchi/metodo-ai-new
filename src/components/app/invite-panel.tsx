"use client";

import { useState } from "react";
import { UserPlus, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { InviteForm } from "@/components/app/invite-form";

/** Collapsible wrapper around the invite form so the Team page leads with the
 *  member directory, not a form. Opens on demand. */
export function InvitePanel() {
  const t = useTranslations("app.team");
  const [open, setOpen] = useState(false);

  return (
    <section className="glass rounded-xl border border-border shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <UserPlus className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{t("inviteTitle")}</span>
          <span className="block text-xs text-muted-foreground">{t("inviteSubtitle")}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="border-t border-border p-5">
          <InviteForm />
        </div>
      ) : null}
    </section>
  );
}
