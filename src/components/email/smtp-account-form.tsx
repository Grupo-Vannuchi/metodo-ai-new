"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { FieldError, Input, Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { saveSmtpAccount, type SmtpSaveResult } from "@/app/actions/email-sender-accounts";
import { LIMITS } from "@/config/limits";
import {
  canKeepSmtpPassword,
  defaultSmtpSecurity,
  SMTP_PORTS,
  type SmtpPort,
  type SmtpSecurity,
} from "@/lib/email-broadcast/smtp/core";
import { smtpAccountSchema, type SmtpAccountInput } from "@/lib/validations/email-smtp-account";
import { cn } from "@/lib/utils";

/** What the form opens with. There is no password in it: the saved one never leaves the server. */
export type SmtpFormInitial = {
  email: string;
  displayName: string;
  host: string;
  port: SmtpPort;
  security: SmtpSecurity;
  username: string;
  hourlyLimit: number;
  dailyLimit: number;
};

/**
 * "new": no SMTP account yet. "edit": the connected account. "reconnect": the
 * account needs its password again (or its server too, when the stored
 * credentials can't be read, and then the server and user come empty).
 */
export type SmtpFormMode = "new" | "edit" | "reconnect";

/** The fields whose problems the form names next to them. */
type FieldKey = "email" | "host" | "port" | "hourlyLimit";

/** The same fields in the order they are on the page: the first one with a problem gets the focus. */
const FIELD_ORDER: readonly FieldKey[] = ["email", "host", "port", "hourlyLimit"];

/** A refusal shown above the button. `focus`: the alert takes the focus (nothing else on the page has a better claim to it). */
type FormError = { message: string; technical?: string; focus: boolean };

/** The account schema's stable issue messages (validations/email-smtp-account.ts) and the field each belongs to. */
function fieldOfIssue(message: string): FieldKey | null {
  switch (message) {
    case "invalid_email":
      return "email";
    case "invalid_host":
      return "host";
    case "invalid_port":
      return "port";
    case "hourly_over_daily":
      return "hourlyLimit";
    default:
      return null;
  }
}

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none aria-[invalid=true]:border-red-500",
);

/**
 * Connect, edit or reconnect the company's SMTP account (spec 2026-10-21, 4.1
 * and 6). "Testar e salvar" connects to the server and logs in before anything
 * is saved, so a wrong server, port or password is told here and nothing is
 * stored. The password is never filled in: in an edit it can stay blank only
 * while the server, port, security and user are the ones it was typed for (the
 * same rule the server applies, canKeepSmtpPassword). Changing the sender's
 * address in an edit replaces the account (the server saves another row), so
 * that asks first.
 */
export function SmtpAccountForm({ initial: initialProp, mode: modeProp }: { initial: SmtpFormInitial; mode: SmtpFormMode }) {
  const t = useTranslations("emailBroadcast");
  const ta = useTranslations("auth");
  const format = useFormatter();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  // What the form opened with, for the whole visit: a save revalidates this page, so the props change under a form
  // that is about to leave, and the rules below compare against the account as the person found it.
  const [{ initial, mode }] = useState({ initial: initialProp, mode: modeProp });
  const [email, setEmail] = useState(initial.email);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState<SmtpPort>(initial.port);
  const [security, setSecurity] = useState<SmtpSecurity>(initial.security);
  // The user comes filled with the e-mail and follows it until the person types their own (null = follows).
  const [typedUsername, setTypedUsername] = useState<string | null>(
    initial.username === "" || initial.username === initial.email ? null : initial.username,
  );
  const [password, setPassword] = useState("");
  const [hourly, setHourly] = useState(String(initial.hourlyLimit));
  const [daily, setDaily] = useState(String(initial.dailyLimit));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [error, setError] = useState<FormError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();
  const emailRef = useRef<HTMLInputElement>(null);
  const hostRef = useRef<HTMLInputElement>(null);
  const portRef = useRef<HTMLSelectElement>(null);
  const hourlyRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  // The "change the e-mail?" question is open: a second submit has to wait for the answer.
  const asking = useRef(false);

  // A refusal shows above the button, so the focus goes to it: a keyboard user would otherwise start over from the top.
  useEffect(() => {
    if (error?.focus) alertRef.current?.focus();
  }, [error]);

  const emailNorm = email.trim().toLowerCase();
  const hostNorm = host.trim().toLowerCase();
  const shownUsername = typedUsername ?? emailNorm;
  const username = shownUsername.trim() || emailNorm;
  const maxHourly = format.number(LIMITS.smtpHourlyMax);
  const maxDaily = format.number(LIMITS.smtpDailyMax);
  // Saving another address replaces the account: a new row, and the sends in progress through the old one pause.
  const emailChanged = mode === "edit" && emailNorm !== "" && emailNorm !== initial.email;
  // Blank is "keep the saved password" only for an edit that still points where the password was typed.
  const keepPassword =
    mode === "edit" &&
    canKeepSmtpPassword(
      { host: initial.host, port: initial.port, security: initial.security, username: initial.username, status: "ACTIVE" },
      { host: hostNorm, port, security, username },
    );
  const passwordHint =
    mode !== "edit"
      ? t("smtp.form.passwordNew")
      : keepPassword
        ? t("smtp.form.passwordKeep")
        : t("smtp.form.passwordChanged");

  function clearField(key: FieldKey) {
    setFieldErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }

  function focusField(key: FieldKey) {
    const ref = key === "email" ? emailRef : key === "host" ? hostRef : key === "port" ? portRef : hourlyRef;
    ref.current?.focus();
  }

  function onPort(value: string) {
    const next = SMTP_PORTS.find((p) => String(p) === value);
    if (next === undefined) return;
    setPort(next);
    // 465 starts in TLS and 587/2525 upgrade with STARTTLS; the person can still change it.
    setSecurity(defaultSmtpSecurity(next));
    clearField("port");
  }

  function errorMessage(code: Extract<SmtpSaveResult, { ok: false }>["error"]): string {
    if (code === "unauthorized" || code === "forbidden" || code === "unknown") return t(`error.${code}`);
    return t(`smtp.error.${code}`, { host: hostNorm, port });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || saved || asking.current) return;
    setError(null);
    const input: SmtpAccountInput = {
      email,
      displayName,
      host,
      port,
      security,
      username,
      password,
      hourlyLimit: Number(hourly),
      dailyLimit: Number(daily),
    };
    // The same schema the server applies: a pasted "smtp://host:587", a bad e-mail or an hourly limit over the
    // daily one is told at its field, with no round trip. What the schema says in raw zod text is the generic message.
    const check = smtpAccountSchema.safeParse(input);
    if (!check.success) {
      const next: Partial<Record<FieldKey, string>> = {};
      let other = false;
      for (const issue of check.error.issues) {
        const field = fieldOfIssue(issue.message);
        if (field) next[field] ??= t(`smtp.fieldError.${issue.message}`);
        else other = true;
      }
      setFieldErrors(next);
      // The first field with a problem takes the focus; the generic message only when no field is to blame.
      const first = FIELD_ORDER.find((key) => next[key]);
      if (first) focusField(first);
      if (other) setError({ message: t("smtp.error.invalid"), focus: !first });
      return;
    }
    setFieldErrors({});
    if (emailChanged) {
      asking.current = true;
      const go = await confirm({
        description: t("smtp.form.emailChangeConfirm", { from: initial.email, to: emailNorm }),
        confirmLabel: t("smtp.form.emailChangeConfirmLabel"),
      });
      asking.current = false;
      if (!go) {
        emailRef.current?.focus();
        return;
      }
    }
    start(async () => {
      try {
        const r = await saveSmtpAccount(input);
        if (!r.ok) {
          // Nothing typed is lost: the fields keep their values, only the reason is shown.
          setError({ message: errorMessage(r.error), technical: r.technical, focus: true });
          return;
        }
        setSaved(true);
        toast(t("smtp.saved"));
        router.push("/app/email/new");
        router.refresh();
      } catch {
        setError({ message: t("error.unknown"), focus: true });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-6 rounded-xl border border-border bg-card p-6">
      <p className="text-sm text-muted-foreground">{t("smtp.intro")}</p>
      {mode === "reconnect" ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {/* Stored data that can't be read (no server left) wasn't refused by the server: its own words. */}
          {initial.host === "" ? t("smtp.reconnectNoticeUnreadable") : t("smtp.reconnectNotice")}
        </p>
      ) : null}

      <fieldset disabled={busy || saved} className="flex min-w-0 flex-col gap-8">
        {/* The columns below only start where they have room: the sidebar takes 16rem from md, so a form at md is
            ~400px wide (two columns of ~190px, and a server name in ~70px); from lg it has ~650px. */}
        <section aria-labelledby="smtpSenderTitle" className="flex flex-col gap-4">
          <h2 id="smtpSenderTitle" className="text-sm font-semibold">
            {t("smtp.form.senderSection")}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
            <div>
              <Label htmlFor="smtpEmail">{t("smtp.form.email")}</Label>
              <Input
                id="smtpEmail"
                ref={emailRef}
                value={email}
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                required
                placeholder={t("smtp.form.emailPlaceholder")}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby="smtpEmailHint smtpEmailError"
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearField("email");
                }}
              />
              {emailChanged ? (
                <p id="smtpEmailHint" className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  {t("smtp.form.emailChangeHint", { email: initial.email })}
                </p>
              ) : null}
              <div id="smtpEmailError">
                <FieldError>{fieldErrors.email}</FieldError>
              </div>
            </div>
            <div>
              <Label htmlFor="smtpName">
                {t("smtp.form.displayName")}{" "}
                <span className="font-normal text-muted-foreground">{t("optional")}</span>
              </Label>
              <Input
                id="smtpName"
                value={displayName}
                autoComplete="off"
                maxLength={100}
                aria-describedby="smtpNameHint"
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <p id="smtpNameHint" className="mt-1 text-xs text-muted-foreground">
                {t("smtp.form.displayNameHint")}
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="smtpServerTitle" className="flex flex-col gap-4">
          <h2 id="smtpServerTitle" className="text-sm font-semibold">
            {t("smtp.form.serverSection")}
          </h2>
          {/* The server's name gets a row of its own until lg, where it shares one with the port and the security. */}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_7rem_11rem]">
            <div className="sm:col-span-2 lg:col-span-1">
              <Label htmlFor="smtpHost">{t("smtp.form.host")}</Label>
              <Input
                id="smtpHost"
                ref={hostRef}
                value={host}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={253}
                required
                placeholder={t("smtp.form.hostPlaceholder")}
                aria-invalid={Boolean(fieldErrors.host)}
                aria-describedby="smtpHostHint smtpHostError"
                onChange={(e) => {
                  setHost(e.target.value);
                  clearField("host");
                }}
              />
              <p id="smtpHostHint" className="mt-1 text-xs text-muted-foreground">
                {t("smtp.form.hostHint")}
              </p>
              <div id="smtpHostError">
                <FieldError>{fieldErrors.host}</FieldError>
              </div>
            </div>
            <div>
              <Label htmlFor="smtpPort">{t("smtp.form.port")}</Label>
              <select
                id="smtpPort"
                ref={portRef}
                className={selectCls}
                value={port}
                aria-invalid={Boolean(fieldErrors.port)}
                aria-describedby="smtpPortError"
                onChange={(e) => onPort(e.target.value)}
              >
                {SMTP_PORTS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <div id="smtpPortError">
                <FieldError>{fieldErrors.port}</FieldError>
              </div>
            </div>
            <div>
              <Label htmlFor="smtpSecurity">{t("smtp.form.security")}</Label>
              <select
                id="smtpSecurity"
                className={selectCls}
                value={security}
                aria-describedby="smtpSecurityHint"
                onChange={(e) => setSecurity(e.target.value === "ssl" ? "ssl" : "starttls")}
              >
                <option value="ssl">{t("smtp.form.securitySsl")}</option>
                <option value="starttls">{t("smtp.form.securityStarttls")}</option>
              </select>
            </div>
          </div>
          <p id="smtpSecurityHint" className="-mt-1 text-xs text-muted-foreground">
            {t("smtp.form.securityHint")}
          </p>
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
            <div>
              <Label htmlFor="smtpUser">{t("smtp.form.username")}</Label>
              <Input
                id="smtpUser"
                value={shownUsername}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                placeholder={emailNorm}
                aria-describedby="smtpUserHint"
                onChange={(e) => setTypedUsername(e.target.value)}
              />
              <p id="smtpUserHint" className="mt-1 text-xs text-muted-foreground">
                {t("smtp.form.usernameHint")}
              </p>
            </div>
            <div>
              <Label htmlFor="smtpPassword">{t("smtp.form.password")}</Label>
              <PasswordInput
                id="smtpPassword"
                value={password}
                autoComplete="new-password"
                maxLength={512}
                required={!keepPassword}
                // A reconnect with a readable server only needs the new password.
                autoFocus={mode === "reconnect" && initial.host !== ""}
                aria-describedby="smtpPasswordHint"
                showLabel={ta("showPassword")}
                hideLabel={ta("hidePassword")}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p
                id="smtpPasswordHint"
                className={cn(
                  "mt-1 text-xs",
                  mode === "edit" && !keepPassword
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-muted-foreground",
                )}
              >
                {passwordHint}
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="smtpLimitsTitle" className="flex flex-col gap-4">
          <h2 id="smtpLimitsTitle" className="text-sm font-semibold">
            {t("smtp.form.limitsSection")}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
            <div>
              <Label htmlFor="smtpHourly">{t("smtp.form.hourlyLimit")}</Label>
              <Input
                id="smtpHourly"
                ref={hourlyRef}
                type="number"
                inputMode="numeric"
                min={1}
                max={LIMITS.smtpHourlyMax}
                step={1}
                required
                value={hourly}
                aria-invalid={Boolean(fieldErrors.hourlyLimit)}
                aria-describedby="smtpHourlyHint smtpHourlyError"
                onChange={(e) => {
                  setHourly(e.target.value);
                  clearField("hourlyLimit");
                }}
              />
              <p id="smtpHourlyHint" className="mt-1 text-xs text-muted-foreground">
                {t("smtp.form.hourlyHint", { max: maxHourly })}
              </p>
              <div id="smtpHourlyError">
                <FieldError>{fieldErrors.hourlyLimit}</FieldError>
              </div>
            </div>
            <div>
              <Label htmlFor="smtpDaily">{t("smtp.form.dailyLimit")}</Label>
              <Input
                id="smtpDaily"
                type="number"
                inputMode="numeric"
                min={1}
                max={LIMITS.smtpDailyMax}
                step={1}
                required
                value={daily}
                aria-describedby="smtpDailyHint"
                onChange={(e) => {
                  setDaily(e.target.value);
                  clearField("hourlyLimit");
                }}
              />
              <p id="smtpDailyHint" className="mt-1 text-xs text-muted-foreground">
                {t("smtp.form.dailyHint", { max: maxDaily })}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("smtp.form.limitsNote")}</p>
        </section>
      </fieldset>

      {error ? (
        // The server's own wording for a refusal is the hover text, as in the failure reasons of a send.
        <p
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          title={error.technical}
          className={cn(
            "rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
            error.technical && "cursor-help",
          )}
        >
          {error.message}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Link href="/app/email" className={buttonVariants({ variant: "outline" })}>
          {t("smtp.form.cancel")}
        </Link>
        <Button type="submit" disabled={busy || saved}>
          {busy ? t("smtp.form.testing") : t("smtp.form.submit")}
        </Button>
      </div>
    </form>
  );
}
