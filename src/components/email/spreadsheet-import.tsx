"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  MAX_IMPORTS,
  MAX_IMPORT_NAME,
  MAX_SPREADSHEET_BYTES,
  SPREADSHEET_ACCEPT,
  audienceEmailCount,
  extractEmails,
  fitImport,
  spreadsheetKind,
  xlsxCellTexts,
} from "@/lib/email-broadcast/spreadsheet";
import type { AudienceSelection } from "@/lib/validations/email-broadcast";

type SheetImport = AudienceSelection["imports"][number];

/** Cell texts of a .csv (the whole text) or an .xlsx (exceljs, loaded only now: it's heavy). */
async function cellTexts(file: File, kind: "xlsx" | "csv"): Promise<string[]> {
  if (kind === "csv") return [await file.text()];
  const excel = await import("exceljs");
  return xlsxCellTexts(excel.default ?? excel, await file.arrayBuffer());
}

/**
 * "Planilha" block of the recipients: files are read in the browser and only
 * their addresses go into the audience. Typed + imported addresses share
 * MAX_AUDIENCE_EMAILS. While reading, the parent disables save/send and
 * removal is blocked here, so the list built across awaits can't race an edit.
 */
export function SpreadsheetImport({
  imports,
  typedCount,
  onChange,
  onReadingChange,
}: {
  imports: SheetImport[];
  typedCount: number;
  onChange: (next: SheetImport[]) => void;
  onReadingChange: (reading: boolean) => void;
}) {
  const t = useTranslations("emailBroadcast");
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Typed addresses can change while a file is read; the cap uses the latest count.
  const latestTyped = useRef(typedCount);
  useEffect(() => {
    latestTyped.current = typedCount;
  }, [typedCount]);

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0 || reading) return;
    const picked = Array.from(files);
    if (input.current) input.current.value = "";
    let list = imports;
    setReading(true);
    onReadingChange(true);
    try {
      for (const file of picked) {
        if (list.length >= MAX_IMPORTS) {
          toast(t("sheet.maxFiles", { max: MAX_IMPORTS, file: file.name }), { variant: "error" });
          continue;
        }
        const kind = spreadsheetKind(file.name);
        if (kind === "xls") {
          toast(t("sheet.xls"), { variant: "error" });
          continue;
        }
        if (!kind) {
          toast(t("sheet.unsupported", { file: file.name }), { variant: "error" });
          continue;
        }
        if (file.size > MAX_SPREADSHEET_BYTES) {
          toast(t("sheet.tooBig", { file: file.name }), { variant: "error" });
          continue;
        }
        let found: ReturnType<typeof extractEmails>;
        try {
          found = extractEmails(await cellTexts(file, kind));
        } catch (error) {
          console.error("[email-spreadsheet] read failed", error);
          toast(t("sheet.unreadable", { file: file.name }), { variant: "error" });
          continue;
        }
        if (found.emails.length === 0) {
          toast(t("sheet.empty", { file: file.name }), { variant: "error" });
          continue;
        }
        const used = audienceEmailCount({ emails: [], imports: list }) + latestTyped.current;
        const { kept, dropped } = fitImport(found.emails, used);
        if (kept.length > 0) {
          list = [...list, { fileName: file.name.slice(0, MAX_IMPORT_NAME), emails: kept }];
          onChange(list);
        }
        if (kept.length === 0) {
          toast(t("sheet.full", { file: file.name }), { variant: "error" });
        } else if (dropped > 0) {
          toast(t("sheet.limit", { kept: kept.length, file: file.name, dropped }), { variant: "error" });
        } else {
          const ignored =
            found.invalid + found.duplicates > 0
              ? ` ${t("sheet.ignored", { invalid: found.invalid, duplicates: found.duplicates })}`
              : "";
          toast(t("sheet.imported", { count: kept.length, file: file.name }) + ignored);
        }
      }
    } finally {
      setReading(false);
      onReadingChange(false);
    }
  }

  const removeEmail = (index: number, email: string) =>
    onChange(
      imports
        .map((imp, i) => (i === index ? { ...imp, emails: imp.emails.filter((e) => e !== email) } : imp))
        .filter((imp) => imp.emails.length > 0),
    );

  const chooseButton = (
    <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={reading}>
      {reading ? t("sheet.reading") : t("sheet.choose")}
    </Button>
  );

  return (
    <div
      className="flex flex-col gap-2.5"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        void onPick(e.dataTransfer.files);
      }}
    >
      {/* Not a <label>: the hidden file input is driven by the buttons below. */}
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <FileSpreadsheet className="size-4 text-brand" />
        {t("sheet.title")}
      </h3>
      <input
        ref={input}
        type="file"
        multiple
        accept={SPREADSHEET_ACCEPT}
        className="hidden"
        onChange={(e) => void onPick(e.target.files)}
      />

      {imports.length === 0 ? (
        <div
          className={cn(
            "flex flex-col items-center gap-2.5 rounded-lg border-[1.5px] border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-brand bg-brand/5" : "border-border bg-muted/40",
          )}
        >
          <Upload className="size-7 text-muted-foreground" aria-hidden />
          <p className="text-sm">{t("sheet.drop")}</p>
          {chooseButton}
          <p className="text-xs text-muted-foreground">{t("sheet.formats")}</p>
        </div>
      ) : (
        <>
          {imports.map((imp, index) => (
            <div
              key={`${index}:${imp.fileName}`}
              className={cn(
                "overflow-hidden rounded-lg border",
                dragging ? "border-brand" : "border-border",
              )}
            >
              <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-3.5 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                  <FileSpreadsheet className="size-[18px]" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{imp.fileName}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {t("sheet.count", { count: imp.emails.length })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onChange(imports.filter((_, i) => i !== index))}
                  disabled={reading}
                  aria-label={t("sheet.removeNamed", { file: imp.fileName })}
                  className="shrink-0 rounded-md px-2 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  {t("sheet.remove")}
                </button>
              </div>
              <ul className="max-h-60 overflow-y-auto py-1">
                {imp.emails.map((email) => (
                  <li key={email} className="flex items-center justify-between gap-3 py-0.5 pl-3.5 pr-1.5 text-sm">
                    <span className="truncate">{email}</span>
                    <button
                      type="button"
                      onClick={() => removeEmail(index, email)}
                      disabled={reading}
                      aria-label={t("remove", { email })}
                      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={reading}
            className="inline-flex items-center gap-1.5 self-start py-1 text-sm font-medium text-brand hover:underline disabled:opacity-50"
          >
            <Upload className="size-4" aria-hidden />
            {reading ? t("sheet.reading") : t("sheet.another")}
          </button>
        </>
      )}
      <p className="text-xs text-muted-foreground">{t("sheet.hint")}</p>
    </div>
  );
}
