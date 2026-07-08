"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { deleteProposalTemplate } from "@/app/actions/proposal-templates";

/** Delete a template from a list row: confirm, delete, refresh. */
export function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("proposalTemplates");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async (e) => {
        e.stopPropagation();
        if (!(await confirm({ description: t("confirmDelete", { name }), confirmLabel: t("delete"), variant: "danger" }))) return;
        start(async () => {
          const r = await deleteProposalTemplate(id);
          if (r.ok) router.refresh();
        });
      }}
      aria-label={t("delete")}
      title={t("delete")}
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
