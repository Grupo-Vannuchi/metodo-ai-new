"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, KeyRound, RefreshCw, Trash2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  connectCloudNumber,
  disconnectCloudNumber,
  refreshCloudNumber,
  removeCloudNumber,
  syncCloudTemplates,
  updateCloudNumberToken,
  type NumberActionResult,
} from "@/app/actions/inbox-oficial-number";

export type NumberView = {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  status: "ACTIVE" | "INACTIVE" | "ERROR";
  lastError: string | null;
};

export type TemplateView = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectedReason: string | null;
};

type Fail = Extract<NumberActionResult, { ok: false }>;

/** Engrenagem da tela oficial: conectar, trocar token, desconectar, remover e modelos. */
export function NumberSettings({ number, templates }: { number: NumberView | null; templates: TemplateView[] }) {
  const t = useTranslations("inboxOficial");
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState("");

  async function run(action: () => Promise<NumberActionResult>, success?: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await action();
      if (r.ok) {
        toast(success ?? (r.count !== undefined ? t("templates.synced", { count: r.count }) : t("number.done")));
        router.refresh();
      } else {
        setError(t(`errors.${(r as Fail).error}`, { detail: (r as Fail).detail ?? "" }));
      }
    } finally {
      setBusy(false);
    }
  }

  const showConnect = !number || number.status === "INACTIVE";

  return (
    <div className="flex w-full flex-col gap-6">
      {showConnect ? (
        <ConnectForm
          defaults={number}
          busy={busy}
          onSubmit={(v) => run(() => connectCloudNumber(v))}
        />
      ) : (
        <section className="glass rounded-2xl border border-border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <BadgeCheck className="size-5" />
              </span>
              <div>
                <p className="font-semibold">{number.verifiedName ?? t("number.title")}</p>
                <p className="text-sm text-muted-foreground">{number.displayPhoneNumber ?? number.phoneNumberId}</p>
              </div>
            </div>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
                number.status === "ACTIVE"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                  : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
              )}
            >
              {t(`number.status.${number.status}`)}
            </span>
          </div>
          {number.qualityRating ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("number.quality", { quality: number.qualityRating })}</p>
          ) : null}
          {number.lastError ? <p className="mt-2 text-sm text-red-500">{number.lastError}</p> : null}

          <div className="mt-5 grid gap-2">
            <Label htmlFor="new-token">{t("number.newToken")}</Label>
            <p className="-mt-1 text-xs text-muted-foreground">{t("number.newTokenHint")}</p>
            <div className="flex gap-2">
              <Input
                id="new-token"
                type="password"
                autoComplete="off"
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto"
                disabled={busy || newToken.trim().length < 20}
                onClick={() => run(async () => {
                  const r = await updateCloudNumberToken(newToken);
                  if (r.ok) setNewToken("");
                  return r;
                })}
              >
                <KeyRound className="size-4" />
                {t("number.saveToken")}
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run(refreshCloudNumber)}>
              <RefreshCw className="size-4" />
              {t("number.refresh")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                if (await confirm({ description: t("number.disconnectConfirm") })) await run(disconnectCloudNumber);
              }}
            >
              <Unplug className="size-4" />
              {t("number.disconnect")}
            </Button>
          </div>
        </section>
      )}

      {number ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (await confirm({ description: t("number.removeConfirm"), variant: "danger" })) await run(removeCloudNumber);
            }}
          >
            <Trash2 className="size-4" />
            {t("number.remove")}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      ) : null}

      {number ? (
        <section className="glass rounded-2xl border border-border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{t("templates.title")}</h2>
              <p className="text-xs text-muted-foreground">{t("templates.hint")}</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={busy || number.status !== "ACTIVE"} onClick={() => run(syncCloudTemplates)}>
              <RefreshCw className="size-4" />
              {t("templates.sync")}
            </Button>
          </div>
          {templates.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("templates.empty")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {templates.map((tpl) => (
                <li key={tpl.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium">{tpl.name}</span>{" "}
                    <span className="text-muted-foreground">
                      {tpl.language} · {tpl.category}
                    </span>
                    {tpl.rejectedReason ? (
                      <span className="block text-xs text-red-500">{t("templates.reason", { reason: tpl.rejectedReason })}</span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      tpl.status === "APPROVED" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {tpl.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ConnectForm({
  defaults,
  busy,
  onSubmit,
}: {
  defaults: NumberView | null;
  busy: boolean;
  onSubmit: (v: { phoneNumberId: string; wabaId: string; accessToken: string; pin: string }) => void;
}) {
  const t = useTranslations("inboxOficial.connect");
  const [phoneNumberId, setPhoneNumberId] = useState(defaults?.phoneNumberId ?? "");
  const [wabaId, setWabaId] = useState(defaults?.wabaId ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [pin, setPin] = useState("");

  return (
    <form
      className="glass flex flex-col gap-4 rounded-2xl border border-border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ phoneNumberId: phoneNumberId.trim(), wabaId: wabaId.trim(), accessToken: accessToken.trim(), pin: pin.trim() });
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pnid">{t("phoneNumberId")}</Label>
          <Input id="pnid" inputMode="numeric" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="waba">{t("wabaId")}</Label>
          <Input id="waba" inputMode="numeric" value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="token">{t("token")}</Label>
        <Input id="token" type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
        <p className="mt-1 text-xs text-muted-foreground">{t("tokenHint")}</p>
      </div>
      <div className="sm:max-w-xs">
        <Label htmlFor="pin">{t("pin")}</Label>
        <Input id="pin" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} />
        <p className="mt-1 text-xs text-muted-foreground">{t("pinHint")}</p>
      </div>
      <div>
        <Button type="submit" disabled={busy || !phoneNumberId.trim() || !wabaId.trim() || !accessToken.trim()}>
          {busy ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
