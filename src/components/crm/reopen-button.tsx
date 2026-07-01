"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { setOpportunityStatus } from "@/app/actions/opportunities";

/** Reopen a closed opportunity — sets it back to OPEN (returns to the board). */
export function ReopenButton({ id }: { id: string }) {
  const t = useTranslations("crm.closed");
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setOpportunityStatus(id, "OPEN");
          if (r.ok) router.refresh();
        })
      }
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <RotateCcw className="size-3.5" />
      {t("reopen")}
    </button>
  );
}
