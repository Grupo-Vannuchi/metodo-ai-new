"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Loader2, Smartphone, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import {
  connectEvolution,
  evolutionStatus,
  disconnectEvolution,
} from "@/app/actions/evolution";

type Phase = "idle" | "loading" | "qr" | "connected";

export function EvolutionConnect({
  id,
  initialActive,
}: {
  id: string;
  initialActive: boolean;
}) {
  const t = useTranslations("connections.evo");
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(initialActive ? "connected" : "idle");
  const [qr, setQr] = useState<string | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the connection state while a QR is showing; stop once open.
  useEffect(() => {
    if (phase !== "qr") return;
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
  }, [phase, id, router]);

  async function startConnect() {
    setError(null);
    setBusy(true);
    setPhase("loading");
    const r = await connectEvolution(id);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "error");
      setPhase("idle");
      return;
    }
    setQr(r.qrBase64 ?? null);
    setPairing(r.pairingCode ?? null);
    setPhase("qr");
  }

  async function disconnect() {
    setBusy(true);
    await disconnectEvolution(id);
    setBusy(false);
    setPhase("idle");
    setQr(null);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">{t("title")}</h2>

      {phase === "connected" ? (
        <div className="mt-3 flex items-center justify-between">
          <p className="inline-flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            {t("connected")}
          </p>
          <Button type="button" variant="outline" onClick={disconnect} disabled={busy}>
            {t("disconnect")}
          </Button>
        </div>
      ) : phase === "qr" ? (
        <div className="mt-3 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">{t("scanHint")}</p>
          {qr ? (
            <Image
              src={qr}
              alt="QR code"
              width={240}
              height={240}
              unoptimized
              className="rounded-lg border border-border"
            />
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
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{t("idleHint")}</p>
          <Button type="button" onClick={startConnect} disabled={busy}>
            {phase === "loading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Smartphone className="size-4" />
            )}
            {t("connect")}
          </Button>
        </div>
      )}

      {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
    </section>
  );
}
