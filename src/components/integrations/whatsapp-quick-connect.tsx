"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Loader2, Smartphone, CheckCircle2, ArrowRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { connectWhatsapp, evolutionStatus } from "@/app/actions/evolution";

type Phase = "idle" | "loading" | "qr" | "connected";

/**
 * One-click "Connect my WhatsApp": provisions the caller's own instance on the
 * shared platform Evolution server (no API keys), shows a QR to scan and polls
 * until it links. Each user gets an isolated number; the inbox is scoped to the
 * owner. `initialActive` reflects whether they already have a live connection.
 */
export function WhatsappQuickConnect({ initialActive }: { initialActive: boolean }) {
  const t = useTranslations("connections.evo");
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(initialActive ? "connected" : "idle");
  const [qr, setQr] = useState<string | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (phase !== "qr" || !connIdRef.current) return;
    const id = connIdRef.current;
    pollRef.current = setInterval(async () => {
      const r = await evolutionStatus(id);
      if (r.state === "open") {
        setPhase("connected");
        setQr(null);
        router.refresh();
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [phase, router]);

  async function start() {
    setError(null);
    setBusy(true);
    setPhase("loading");
    const r = await connectWhatsapp();
    setBusy(false);
    if (!r.ok) {
      setError(r.error === "platform_not_configured" ? t("notConfigured") : t("genericError"));
      setPhase("idle");
      return;
    }
    connIdRef.current = r.connectionId;
    setQr(r.qrBase64 ?? null);
    setPairing(r.pairingCode ?? null);
    setPhase("qr");
  }

  return (
    <section className="glass rounded-2xl border border-border p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Smartphone className="size-5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{t("quickTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("quickHint")}</p>
        </div>
      </div>

      {phase === "connected" ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            {t("quickConnected")}
          </p>
          <Link href="/app/inbox?mode=whatsapp" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("openInbox")}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      ) : phase === "qr" ? (
        <div className="mt-4 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">{t("scanHint")}</p>
          {qr ? (
            <Image src={qr} alt="QR code" width={240} height={240} unoptimized className="rounded-lg border border-border bg-white p-1" />
          ) : (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          )}
          {pairing ? (
            <p className="text-sm">
              {t("pairingCode")}: <span className="font-mono font-semibold">{pairing}</span>
            </p>
          ) : null}
          <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t("waiting")}
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <Button type="button" onClick={start} disabled={busy}>
            {phase === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
            {t("connect")}
          </Button>
        </div>
      )}

      {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
    </section>
  );
}
