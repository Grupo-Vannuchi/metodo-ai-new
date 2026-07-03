"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { deleteOpportunity } from "@/app/actions/opportunities";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Delete the opportunity from its detail page: confirms, deletes (which also
 * drops its attachment blobs), then returns to the funnel — where the remembered
 * pipeline reopens automatically.
 */
export function DeleteOpportunityButton({ id }: { id: string }) {
  const t = useTranslations("crm.common");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ description: t("confirmDelete"), confirmLabel: t("delete"), variant: "danger" }))) return;
        start(async () => {
          const r = await deleteOpportunity(id);
          if (r.ok) router.push("/app/crm");
        });
      }}
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50",
      )}
    >
      <Trash2 className="size-4" />
      {t("delete")}
    </button>
  );
}
