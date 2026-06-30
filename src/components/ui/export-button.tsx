"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileText, FileSpreadsheet, FileType } from "lucide-react";

/**
 * Reusable "Export" dropdown: PDF / Excel / Word. Downloads from `endpoint`
 * with `params` + the chosen `format`. Used across the inbox and CRM lists.
 */
export function ExportButton({
  endpoint,
  params = {},
  label,
}: {
  endpoint: string;
  params?: Record<string, string>;
  label: string;
}) {
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

  function download(format: "pdf" | "xlsx" | "doc") {
    const sp = new URLSearchParams({ ...params, format });
    const a = document.createElement("a");
    a.href = `${endpoint}?${sp.toString()}`;
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
        className="inline-flex h-[42px] items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
      >
        <Download className="size-4" />
        {label}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-border bg-card p-1.5 shadow-lg">
          <Item icon={FileText} label="PDF" onClick={() => download("pdf")} />
          <Item icon={FileSpreadsheet} label="Excel" onClick={() => download("xlsx")} />
          <Item icon={FileType} label="Word" onClick={() => download("doc")} />
        </div>
      ) : null}
    </div>
  );
}

function Item({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
    >
      <Icon className="size-4 text-muted-foreground" />
      {label}
    </button>
  );
}
