"use client";

import { useState, useTransition } from "react";
import { Send, X, MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { resendInvitation, revokeInvitation } from "@/app/actions/organizations";
import type { PendingInvitation } from "@/lib/queries/organizations";

const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString("pt-BR");

/** Pending invitations with resend (rotates the link) + revoke. Admin-only. */
export function PendingInvitations({ invitations }: { invitations: PendingInvitation[] }) {
  const t = useTranslations("app.team");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  if (invitations.length === 0) return null;

  function resend(id: string) {
    setNote(null);
    setBusyId(id);
    start(async () => {
      const r = await resendInvitation(id);
      setBusyId(null);
      if (r.ok) {
        setNote({ id, ok: true, text: r.emailSent ? t("resent") : t("resentNoEmail") });
        router.refresh();
      } else {
        setNote({ id, ok: false, text: t(`inviteActionError.${r.error}`) });
      }
    });
  }

  async function revoke(id: string, email: string) {
    if (!(await confirm({ description: t("revokeConfirm", { email }), confirmLabel: t("revoke"), variant: "danger" }))) return;
    setBusyId(id);
    start(async () => {
      const r = await revokeInvitation(id);
      setBusyId(null);
      if (r.ok) router.refresh();
      else setNote({ id, ok: false, text: t(`inviteActionError.${r.error}`) });
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold">{t("pendingTitle")}</h2>
      </div>
      <ul className="divide-y divide-border">
        {invitations.map((inv) => {
          const busy = pending && busyId === inv.id;
          return (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <MailCheck className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{inv.email}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`role.${inv.role}`)} ·{" "}
                  {inv.expired ? (
                    <span className="text-red-500">{t("inviteExpired")}</span>
                  ) : (
                    t("inviteExpiresOn", { date: fmtDate(inv.expiresAt) })
                  )}
                </p>
                {note && note.id === inv.id ? (
                  <p className={cn("mt-0.5 text-xs", note.ok ? "text-green-600" : "text-red-500")}>{note.text}</p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => resend(inv.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {busy ? <Spinner className="size-3.5" /> : <Send className="size-3.5" />}
                {t("resend")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void revoke(inv.id, inv.email)}
                title={t("revoke")}
                aria-label={t("revoke")}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
              >
                <X className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
