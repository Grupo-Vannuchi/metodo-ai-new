"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { verifyEmail } from "@/app/actions/auth-recovery";

/** Confirm-your-email button. A POST (not the GET link) consumes the token, so
 * e-mail scanners prefetching the link can't burn it. On success the action
 * verifies the account and signs the user in. */
export function VerifyConfirm({ token }: { token: string }) {
  const t = useTranslations("auth.verify");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <Button
        size="lg"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await verifyEmail(token, locale);
            if (r?.error) setError(t("invalid"));
          });
        }}
      >
        {pending ? t("confirming") : t("confirm")}
      </Button>
      {error ? (
        <p role="alert" className="text-center text-sm text-red-500">
          {error}{" "}
          <Link href="/login" className="font-medium text-brand underline underline-offset-4">
            {t("backToLogin")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
