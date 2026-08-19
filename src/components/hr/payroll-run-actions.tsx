"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Undo2, Wallet, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { Spinner } from "@/components/ui/spinner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import {
  approvePayrollRun,
  reopenPayrollRun,
  payPayrollRun,
  deletePayrollRun,
} from "@/app/actions/payroll";
import type { PayrollStatusKey } from "@/lib/validations/payroll";

/** Status transitions for a payroll run. Paying it posts the expenses into the
 * finance ledger, so it asks for confirmation and is irreversible. */
export function PayrollRunActions({
  id,
  status,
  totalNet,
  hasFinance = true,
}: {
  id: string;
  status: PayrollStatusKey;
  totalNet: number;
  hasFinance?: boolean;
}) {
  const t = useTranslations("hr");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (after) after();
        else router.refresh();
      } else {
        setError(t(`payroll.error.${r.error ?? "unknown"}`));
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "DRAFT" ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => approvePayrollRun(id))}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "disabled:opacity-50")}
            >
              {pending ? <Spinner className="size-4" /> : <CheckCircle2 className="size-4" />}
              {t("payroll.approve")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={async () => {
                if (!(await confirm({ description: t("payroll.confirmDelete"), confirmLabel: t("delete"), variant: "danger" }))) return;
                run(
                  () => deletePayrollRun(id),
                  () => router.push("/app/hr/payroll"),
                );
              }}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50",
              )}
            >
              <Trash2 className="size-4" />
              {t("delete")}
            </button>
          </>
        ) : null}

        {status === "APPROVED" ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => reopenPayrollRun(id))}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "disabled:opacity-50")}
            >
              <Undo2 className="size-4" />
              {t("payroll.reopen")}
            </button>
            {hasFinance ? (
              <button
                type="button"
                disabled={pending}
                onClick={async () => {
                  const ok = await confirm({
                    description: t("payroll.confirmPay", { total: formatBRL(totalNet) }),
                    confirmLabel: t("payroll.pay"),
                  });
                  if (!ok) return;
                  run(() => payPayrollRun(id));
                }}
                className={cn(buttonVariants({ size: "sm" }), "disabled:opacity-50")}
              >
                {pending ? <Spinner className="size-4" /> : <Wallet className="size-4" />}
                {t("payroll.pay")}
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
