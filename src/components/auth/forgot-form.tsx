"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Link } from "@/i18n/navigation";
import { requestPasswordReset } from "@/app/actions/auth-recovery";

/** Request a password-reset link. Always confirms "sent" (anti-enumeration). */
export function ForgotForm() {
  const t = useTranslations("auth.forgot");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <MailCheck className="size-8 text-brand" />
        <p className="text-sm text-muted-foreground">{t("sent")}</p>
        <Link href="/login" className="text-sm font-medium text-brand underline underline-offset-4">
          {t("backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await requestPasswordReset(email);
          setSent(true);
        });
      }}
    >
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button type="submit" size="lg" disabled={pending || !email.trim()}>
        {pending ? t("sending") : t("submit")}
      </Button>
      <Link href="/login" className="text-center text-sm text-muted-foreground hover:text-foreground">
        {t("backToLogin")}
      </Link>
    </form>
  );
}
