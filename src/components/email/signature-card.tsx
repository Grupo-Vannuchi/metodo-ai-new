"use client";

import { useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteEmailSignature, setDefaultEmailSignature } from "@/app/actions/email-signatures";
import type { SignatureOption } from "@/lib/email-broadcast/types";

/** One signature of the Assinaturas tab (spec 2026-10-13 §4.2). previewHtml
 * was sanitized on the server. */
export function SignatureCard({ signature }: { signature: SignatureOption }) {
  const t = useTranslations("emailBroadcast.signatures");
  const format = useFormatter();
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const [busy, start] = useTransition();

  const onDelete = () =>
    start(async () => {
      const ok = await confirm({
        title: t("deleteTitle", { name: signature.name }),
        description: t("deleteBody"),
        confirmLabel: t("deleteConfirm"),
        variant: "danger",
      });
      if (!ok) return;
      try {
        const r = await deleteEmailSignature(signature.id);
        if (!r.ok) {
          toast(t(`errors.${r.error}`), { variant: "error" });
          return;
        }
        toast(t("deleted"));
        router.refresh();
      } catch {
        toast(t("errors.unknown"), { variant: "error" });
      }
    });

  const onSetDefault = () =>
    start(async () => {
      try {
        const r = await setDefaultEmailSignature(signature.id);
        if (!r.ok) {
          toast(t(`errors.${r.error}`), { variant: "error" });
          return;
        }
        toast(t("defaultSet"));
        router.refresh();
      } catch {
        toast(t("errors.unknown"), { variant: "error" });
      }
    });

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate font-semibold">{signature.name}</h2>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {signature.kind === "IMAGE" ? t("kindImage") : t("kindText")}
          </span>
        </div>
        {signature.isDefault ? (
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">
            {t("default")}
          </span>
        ) : (
          <button
            type="button"
            onClick={onSetDefault}
            disabled={busy}
            className="text-xs font-semibold text-brand underline-offset-2 hover:underline disabled:opacity-60"
          >
            {t("setDefault")}
          </button>
        )}
      </div>
      <div
        className="max-h-48 overflow-hidden rounded-lg border border-border bg-white p-4 text-sm text-neutral-900"
        dangerouslySetInnerHTML={{ __html: signature.previewHtml }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t("updatedAt", { date: format.dateTime(new Date(signature.updatedAt), { dateStyle: "short" }) })}
        </span>
        <div className="flex gap-2">
          <Link href={`/app/email/signatures/${signature.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("edit")}
          </Link>
          <Button type="button" variant="outline" size="sm" onClick={onDelete} disabled={busy} className="text-red-600">
            {t("delete")}
          </Button>
        </div>
      </div>
    </article>
  );
}
