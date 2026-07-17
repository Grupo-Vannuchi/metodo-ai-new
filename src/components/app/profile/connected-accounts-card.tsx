"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link2, ShieldCheck, ShieldAlert, Unlink } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { buttonVariants, Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import { unlinkAccount } from "@/app/actions/account";
import type { ConnectedAccount } from "@/lib/queries/profile";

/** The official Google "G" mark. */
function GoogleG({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

export function ConnectedAccountsCard({
  email,
  emailVerified,
  hasPassword,
  accounts,
}: {
  email: string;
  emailVerified: Date | null;
  hasPassword: boolean;
  accounts: ConnectedAccount[];
}) {
  const t = useTranslations("profile");
  const router = useRouter();
  const confirm = useConfirm();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const google = accounts.find((a) => a.provider === "google") ?? null;
  const linked = params.get("linked") === "google";
  const linkError = params.get("error"); // google_taken | google

  const fmtDate = (d: Date) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  function unlink() {
    if (!google) return;
    setError(null);
    confirm({
      title: t("accounts.unlinkTitle"),
      description: t("accounts.unlinkConfirm"),
      confirmLabel: t("accounts.unlink"),
      variant: "danger",
    }).then((ok) => {
      if (!ok) return;
      start(async () => {
        const r = await unlinkAccount(google.id);
        if (r.ok) router.refresh();
        else setError(t(`accounts.error.${r.error}`));
      });
    });
  }

  // Can't unlink the only sign-in method (no password AND single account).
  const isLastMethod = !hasPassword && accounts.length <= 1;

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-brand" />
        <h3 className="text-sm font-semibold">{t("accounts.title")}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("accounts.desc")}</p>

      {/* Feedback from the OAuth link round-trip. */}
      {linked ? (
        <p className="mt-3 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600">{t("accounts.linked")}</p>
      ) : null}
      {linkError === "google_taken" ? (
        <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{t("accounts.error.taken")}</p>
      ) : null}

      {/* E-mail verification status. */}
      <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        {emailVerified ? (
          <ShieldCheck className="size-5 shrink-0 text-green-600" />
        ) : (
          <ShieldAlert className="size-5 shrink-0 text-amber-500" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{email}</p>
          <p className="text-xs text-muted-foreground">
            {emailVerified ? t("accounts.emailVerified", { date: fmtDate(emailVerified) }) : t("accounts.emailUnverified")}
          </p>
        </div>
      </div>

      {/* Google identity. */}
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <GoogleG className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Google</p>
          <p className="text-xs text-muted-foreground">
            {google ? t("accounts.connectedOn", { date: fmtDate(google.createdAt) }) : t("accounts.notConnected")}
          </p>
        </div>
        {google ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={unlink}
            disabled={pending || isLastMethod}
            title={isLastMethod ? t("accounts.error.last_method") : undefined}
          >
            <Unlink className="size-4" />
            {t("accounts.unlink")}
          </Button>
        ) : (
          // Full-page navigation to the OAuth API route (not a Next page) — a
          // plain anchor, like the sign-in button. `intent=link` attaches the
          // identity to the current user instead of logging in.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/api/auth/google?intent=link" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            {t("accounts.connect")}
          </a>
        )}
      </div>

      {isLastMethod && google ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("accounts.lastMethodHint")}</p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
