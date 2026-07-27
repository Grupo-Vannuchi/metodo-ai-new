"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useUndoableDelete } from "@/components/ui/undo";
import { deleteProposalTemplate } from "@/app/actions/proposal-templates";

/** Delete a template from a list row: hides the row and defers behind "Undo". */
export function DeleteTemplateButton({ id }: { id: string; name: string }) {
  const t = useTranslations("proposalTemplates");
  const deleteWithUndo = useUndoableDelete();

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        deleteWithUndo({ action: () => deleteProposalTemplate(id), rowFrom: e.currentTarget });
      }}
      aria-label={t("delete")}
      title={t("delete")}
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
