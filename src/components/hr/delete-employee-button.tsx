"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { deleteEmployee } from "@/app/actions/hr";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Delete an employee from their record: confirm, delete (drops document blobs
 * too), then return to the list. */
export function DeleteEmployeeButton({ id }: { id: string }) {
  const t = useTranslations("hr");
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
          const r = await deleteEmployee(id);
          if (r.ok) router.push("/app/hr/employees");
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
