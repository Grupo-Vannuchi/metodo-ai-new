"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Kanban, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatBRL } from "@/lib/money";
import { bulkSendContactsToFunnel } from "@/app/actions/bulk";

/** What the dialog offers: the org's funnels with their stages and the active products. Loaded by the contacts page only when
 * the member can see the funnel (null otherwise, and the two "Enviar ao funil" buttons don't show). */
export type FunnelOptions = {
  pipelines: { id: string; name: string; isDefault: boolean; stages: { id: string; name: string }[] }[];
  products: { id: string; name: string; price: number | null }[];
};

/**
 * "Enviar ao funil": the picked contacts (the selection, or every contact of the open folder, e.g. a WhatsApp group's) become
 * opportunities in the chosen stage. A portal modal like the group one; the rules live on the server
 * (src/lib/crm/contacts-to-funnel.ts) and are told to the member in the text above the button.
 */
export function SendToFunnelDialog({
  contactIds,
  options,
  onClose,
  onDone,
}: {
  contactIds: string[];
  options: FunnelOptions;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("crm.funnelSend");
  const router = useRouter();
  const toast = useToast();
  const titleId = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const usable = options.pipelines.filter((p) => p.stages.length > 0);
  const initial = usable.find((p) => p.isDefault) ?? usable[0];
  const [pipelineId, setPipelineId] = useState(initial?.id ?? "");
  const stages = usable.find((p) => p.id === pipelineId)?.stages ?? [];
  const [stageId, setStageId] = useState(initial?.stages[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const count = contactIds.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  function pickPipeline(id: string) {
    setPipelineId(id);
    setStageId(usable.find((p) => p.id === id)?.stages[0]?.id ?? "");
  }

  function send() {
    if (!stageId || count === 0) return;
    setError(null);
    start(async () => {
      const res = await bulkSendContactsToFunnel(contactIds, stageId, productId || null);
      if (!res.ok) {
        setError(t(`error.${res.error}`));
        return;
      }
      toast(t("done", { created: res.created, skipped: res.skipped }));
      onDone();
      router.refresh();
    });
  }

  const selectCls =
    "mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("close")}
        onClick={() => (pending ? null : onClose())}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm motion-safe:animate-overlay-in"
      />
      <div className="glass-strong relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/15 shadow-2xl motion-safe:animate-dialog-in">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Kanban className="size-5 shrink-0 text-brand" />
              <h2 id={titleId} className="text-base font-semibold">
                {t("title")}
              </h2>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle", { count })}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label={t("close")}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {usable.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPipeline")}</p>
          ) : (
            <>
              <div>
                <Label htmlFor="funnel-send-pipeline">{t("pipeline")}</Label>
                <select
                  id="funnel-send-pipeline"
                  value={pipelineId}
                  disabled={pending}
                  onChange={(e) => pickPipeline(e.target.value)}
                  className={selectCls}
                >
                  {usable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="funnel-send-stage">{t("stage")}</Label>
                <select
                  id="funnel-send-stage"
                  value={stageId}
                  disabled={pending}
                  onChange={(e) => setStageId(e.target.value)}
                  className={selectCls}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="funnel-send-product">{t("product")}</Label>
                <select
                  id="funnel-send-product"
                  value={productId}
                  disabled={pending}
                  onChange={(e) => setProductId(e.target.value)}
                  className={selectCls}
                >
                  <option value="">{t("productNone")}</option>
                  {options.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.price ? ` (${formatBRL(p.price)})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">{t("rules")}</p>
            </>
          )}
          {error ? (
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="button" size="sm" disabled={pending || !stageId || count === 0} onClick={send}>
            {pending ? <Spinner className="size-4" /> : null}
            {pending ? t("sending") : t("send", { count })}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
