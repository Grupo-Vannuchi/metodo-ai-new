"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { confirmEmailChange } from "@/app/actions/email-change";

/** Confirm-your-new-email button. A POST (not the GET link) consumes the token,
 * so e-mail scanners prefetching the link can't burn it. On success the account
 * e-mail is updated. The link is opened from the NEW inbox, so no session. */
export function EmailChangeConfirm({ token }: { token: string }) {
  const t = useTranslations("auth.verifyEmail");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <CheckCircle2 className="size-10 text-green-600" />
        <p className="text-sm text-muted-foreground">{t("done", { email: done })}</p>
        <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "mt-1")}>
          {t("goToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        size="lg"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await confirmEmailChange(token, locale);
            if (r.ok) setDone(r.email);
            else setError(t(`error.${r.error}`));
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
