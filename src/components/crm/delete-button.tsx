"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useUndoableDelete } from "@/components/ui/undo";

/**
 * Generic delete control. Receives a server action already bound to the target
 * id (e.g. `deleteCompany.bind(null, id)`). Instead of confirming up front, it
 * hides the row and defers the delete behind an "Undo" toast — the same safety
 * net used across the app.
 */
export function DeleteButton({
  action,
  label,
}: {
  action: () => Promise<{ ok: boolean }>;
  label?: string;
}) {
  const t = useTranslations("crm.common");
  const deleteWithUndo = useUndoableDelete();

  return (
    <button
      type="button"
      aria-label={label ?? t("delete")}
      onClick={(e) => deleteWithUndo({ action, rowFrom: e.currentTarget })}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
