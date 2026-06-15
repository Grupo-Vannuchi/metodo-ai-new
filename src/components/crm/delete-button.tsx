"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

/**
 * Generic delete control. Receives a server action already bound to the target
 * id (e.g. `deleteCompany.bind(null, id)`), confirms, runs it, and refreshes.
 */
export function DeleteButton({
  action,
  label,
}: {
  action: () => Promise<{ ok: boolean }>;
  label?: string;
}) {
  const t = useTranslations("crm.common");
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={label ?? t("delete")}
      onClick={() => {
        if (!window.confirm(t("confirmDelete"))) return;
        start(async () => {
          await action();
          router.refresh();
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
