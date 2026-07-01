"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Download, FileText, FileSpreadsheet, FileType, UserPlus, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { importWhatsappContactsToCrm } from "@/app/actions/inbox";

type Group = { id: string; name: string };

/**
 * Export the WhatsApp contact list, or a group's members, as PDF / Word / XML.
 * Triggers a download from /api/inbox/export. Lives at the top of the inbox.
 */
export function ExportMenu({ groups }: { groups: Group[] }) {
  const t = useTranslations("inbox");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("contacts");
  const [importing, startImport] = useTransition();
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function download(format: "pdf" | "doc" | "xlsx") {
    const params = new URLSearchParams();
    if (target === "contacts") {
      params.set("type", "contacts");
    } else {
      params.set("type", "group");
      params.set("conversationId", target);
    }
    params.set("format", format);
    const a = document.createElement("a");
    a.href = `/api/inbox/export?${params.toString()}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setOpen(false);
  }

  function importToCrm() {
    setImportMsg(null);
    const arg =
      target === "contacts"
        ? ({ type: "contacts" } as const)
        : ({ type: "group", conversationId: target } as const);
    startImport(async () => {
      const r = await importWhatsappContactsToCrm(arg);
      if (r.ok) {
        setImportMsg(t("export.imported", { created: r.created, skipped: r.skipped }));
        router.refresh();
      } else {
        setImportMsg(t("export.importError"));
      }
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
      >
        <Download className="size-4" />
        {t("export.button")}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-border bg-card p-3 shadow-lg">
          <label className="text-xs font-medium text-muted-foreground">{t("export.target")}</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
          >
            <option value="contacts">{t("export.allContacts")}</option>
            {groups.length ? (
              <optgroup label={t("export.groups")}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>

          <p className="mt-3 text-xs font-medium text-muted-foreground">{t("export.format")}</p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            <FormatBtn icon={FileText} label="PDF" onClick={() => download("pdf")} />
            <FormatBtn icon={FileSpreadsheet} label="Excel" onClick={() => download("xlsx")} />
            <FormatBtn icon={FileType} label="Word" onClick={() => download("doc")} />
          </div>

          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">{t("export.crmTitle")}</p>
            <button
              type="button"
              onClick={importToCrm}
              disabled={importing}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {importing ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              {t("export.toCrm")}
            </button>
            {importMsg ? <p className="mt-2 text-xs text-muted-foreground">{importMsg}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FormatBtn({
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
      className="flex flex-col items-center gap-1 rounded-lg border border-border px-2 py-2 text-xs transition-colors hover:bg-muted"
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
