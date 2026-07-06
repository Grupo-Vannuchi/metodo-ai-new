"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileText, FileType } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Exportar" dropdown for a proposal document — same pattern as the shared
 * {@link ExportButton} (one button, options inside), but with proposal-specific
 * behavior: PDF opens in a new tab (so the print dialog fires) while Word
 * downloads. The API route is locale-agnostic, hence raw URLs.
 */
export function ProposalExportMenu({ proposalId }: { proposalId: string }) {
  const t = useTranslations("proposals");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const base = `/api/proposals/${proposalId}/document`;

  function exportPdf() {
    window.open(`${base}?format=pdf`, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  function exportWord() {
    const a = document.createElement("a");
    a.href = `${base}?format=word`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <Download className="size-4" />
        {t("export")}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-border bg-card p-1.5 shadow-lg">
          <button
            type="button"
            onClick={exportPdf}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
          >
            <FileText className="size-4 text-muted-foreground" />
            PDF
          </button>
          <button
            type="button"
            onClick={exportWord}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
          >
            <FileType className="size-4 text-muted-foreground" />
            Word
          </button>
        </div>
      ) : null}
    </div>
  );
}
