"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link2, ShieldCheck, ShieldAlert, Unlink } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { buttonVariants, Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { ProviderMark } from "@/components/auth/provider-mark";
import { OAUTH_LABELS, isOAuthProvider, type OAuthProvider } from "@/lib/oauth/shared";
import { cn } from "@/lib/utils";
import { unlinkAccount } from "@/app/actions/account";
import type { ConnectedAccount } from "@/lib/queries/profile";

export function ConnectedAccountsCard({
  email,
  emailVerified,
  hasPassword,
  accounts,
  providers,
}: {
  email: string;
  emailVerified: Date | null;
  hasPassword: boolean;
  accounts: ConnectedAccount[];
  providers: OAuthProvider[];
}) {
  const t = useTranslations("profile");
  const router = useRouter();
  const confirm = useConfirm();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Feedback from the OAuth link round-trip: `?linked=<provider>` on success,
  // `?error=<provider>_taken` when that identity already belongs to someone else.
  const linkedParam = params.get("linked");
  const linked = linkedParam && isOAuthProvider(linkedParam) ? OAUTH_LABELS[linkedParam] : null;
  const takenParam = params.get("error");
  const taken = takenParam?.endsWith("_taken") ?? false;

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  // Can't unlink the only sign-in method (no password AND a single account).
  const isLastMethod = !hasPassword && accounts.length <= 1;

  function unlink(accountId: string) {
    setError(null);
    confirm({
      title: t("accounts.unlinkTitle"),
      description: t("accounts.unlinkConfirm"),
      confirmLabel: t("accounts.unlink"),
      variant: "danger",
    }).then((ok) => {
      if (!ok) return;
      start(async () => {
        const r = await unlinkAccount(accountId);
        if (r.ok) router.refresh();
        else setError(t(`accounts.error.${r.error}`));
      });
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-brand" />
        <h3 className="text-sm font-semibold">{t("accounts.title")}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("accounts.desc")}</p>

      {linked ? (
        <p className="mt-3 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600">
          {t("accounts.linked")}
        </p>
      ) : null}
      {taken ? (
        <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {t("accounts.error.taken")}
        </p>
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
            {emailVerified
              ? t("accounts.emailVerified", { date: fmtDate(emailVerified) })
              : t("accounts.emailUnverified")}
          </p>
        </div>
      </div>

      {/* One row per configured provider. */}
      {providers.map((provider) => {
        const account = accounts.find((a) => a.provider === provider) ?? null;
        return (
          <div
            key={provider}
            className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3"
          >
            <ProviderMark provider={provider} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{OAUTH_LABELS[provider]}</p>
              <p className="text-xs text-muted-foreground">
                {account
                  ? t("accounts.connectedOn", { date: fmtDate(account.createdAt) })
                  : t("accounts.notConnected")}
              </p>
            </div>
            {account ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => unlink(account.id)}
                disabled={pending || isLastMethod}
                title={isLastMethod ? t("accounts.error.last_method") : undefined}
              >
                <Unlink className="size-4" />
                {t("accounts.unlink")}
              </Button>
            ) : (
              // Full-page navigation to the OAuth API route (not a Next page) — a
              // plain anchor, like the sign-in buttons. `intent=link` attaches the
              // identity to the current user instead of logging in.
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a
                href={`/api/auth/${provider}?intent=link`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                {t("accounts.connect")}
              </a>
            )}
          </div>
        );
      })}

      {isLastMethod && accounts.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("accounts.lastMethodHint")}</p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
