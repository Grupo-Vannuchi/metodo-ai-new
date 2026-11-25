"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Upload, FileSpreadsheet, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseCsv } from "@/lib/csv";
import { adaptContactCsv, type ContactCsvPreset } from "@/lib/crm/contact-csv-presets";
import { autoMapColumns } from "@/lib/crm/csv-columns";
import { importContactsCsv, importCompaniesCsv, type ImportResult } from "@/app/actions/import-csv";

type Entity = "contacts" | "companies";

/** Rows per action call. The same as the server's write batch (CREATE_CHUNK in import-csv.ts): a part is one transaction, so a
 * part that fails saved nothing, and "Continuar" never writes a row of it twice. */
const PART_SIZE = 500;
/** Rows per file (the same cap the action has per call, kept for the whole file). */
const MAX_ROWS_TOTAL = 5000;

type Totals = { created: number; skipped: number; multiPhone: number; folderId: string | null };
const NO_TOTALS: Totals = { created: 0, skipped: 0, multiPhone: 0, folderId: null };

/** Target fields per entity, in display order. `required` marks name. Aliases
 * are normalized header names we auto-match against. */
const FIELDS: Record<Entity, { key: string; required?: boolean; aliases: string[] }[]> = {
  contacts: [
    { key: "name", required: true, aliases: ["nome", "name", "contato", "cliente", "nome completo"] },
    { key: "email", aliases: ["email", "e mail"] },
    { key: "phone", aliases: ["telefone", "celular", "fone", "phone", "whatsapp", "tel", "numero"] },
    { key: "role", aliases: ["cargo", "funcao", "role", "position", "papel", "job title", "organization title"] },
    { key: "company", aliases: ["empresa", "company", "organizacao", "companhia", "organization"] },
    { key: "tags", aliases: ["tags", "etiquetas", "marcadores", "grupo"] },
  ],
  companies: [
    { key: "name", required: true, aliases: ["nome", "name", "empresa", "razao social", "fantasia", "nome fantasia"] },
    { key: "cnpj", aliases: ["cnpj", "documento", "doc", "cnpj cpf"] },
    { key: "email", aliases: ["email", "e mail"] },
    { key: "phone", aliases: ["telefone", "celular", "fone", "phone", "tel"] },
    { key: "website", aliases: ["site", "website", "url", "pagina", "web"] },
    { key: "city", aliases: ["cidade", "city", "municipio"] },
    { key: "uf", aliases: ["uf", "estado", "state"] },
    { key: "notes", aliases: ["notas", "observacoes", "obs", "notes", "descricao"] },
  ],
};

/** Best-effort header → field guess (rules in src/lib/crm/csv-columns.ts). Each field is claimed at most once. */
function autoMap(entity: Entity, headers: string[]): (string | null)[] {
  return autoMapColumns(FIELDS[entity], headers);
}

export function CsvImport({ entity }: { entity: Entity }) {
  const t = useTranslations("crm.import");
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  // The address book the file came from (Google Contatos, Outlook), when it was recognized and rearranged.
  const [preset, setPreset] = useState<ContactCsvPreset | null>(null);
  // While parts are being sent: how far it got. After a part failed: the totals so far and where to continue.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stopped, setStopped] = useState<(Totals & { at: number; payload: Record<string, string>[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const fields = FIELDS[entity];
  const hasName = useMemo(() => mapping.includes("name"), [mapping]);

  function openModal() {
    setOpen(true);
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping([]);
    setPreset(null);
    setProgress(null);
    setStopped(null);
    setError(null);
    setResult(null);
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setResult(null);
    setStopped(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = parseCsv(String(reader.result ?? ""));
        if (raw.headers.length === 0 || raw.rows.length === 0) {
          setError(t("noRows"));
          return;
        }
        // A contact file exported from Google Contatos or Outlook comes rearranged into the columns below.
        const adapted = entity === "contacts" ? adaptContactCsv(raw) : { preset: null, table: raw };
        const parsed = adapted.table;
        setPreset(adapted.preset);
        setFileName(file.name);
        setHeaders(parsed.headers);
        setRows(parsed.rows);
        setMapping(autoMap(entity, parsed.headers));
      } catch {
        setError(t("parseError"));
      }
    };
    reader.onerror = () => setError(t("parseError"));
    reader.readAsText(file, "utf-8");
  }

  function buildRows(): Record<string, string>[] {
    return rows
      .map((r) => {
        const obj: Record<string, string> = {};
        mapping.forEach((field, col) => {
          if (field) obj[field] = (r[col] ?? "").trim();
        });
        return obj;
      })
      .filter((o) => Object.values(o).some(Boolean));
  }

  /**
   * Sends the rows in parts of PART_SIZE, one action call each (a call's body stays far under the 1 MB limit of a server
   * action, and a failure leaves what came before saved). Every part after the first passes the folder the first one opened,
   * so the file lands in one folder. A part that fails stops the run where it was: the screen says how many were imported and
   * offers to continue from there, which sends the rest (not the whole file again: rows with only a name would repeat).
   */
  async function runParts(payload: Record<string, string>[], from: number, acc: Totals) {
    const send = entity === "contacts" ? importContactsCsv : importCompaniesCsv;
    let totals = acc;
    for (let i = from; i < payload.length; i += PART_SIZE) {
      setProgress({ done: i, total: payload.length });
      let r: ImportResult;
      try {
        r = await send(payload.slice(i, i + PART_SIZE), { folderId: totals.folderId });
      } catch {
        r = { ok: false, error: "unknown" };
      }
      if (!r.ok) {
        setProgress(null);
        if (i === 0) {
          setResult(r);
        } else {
          setStopped({ ...totals, at: i, payload });
          router.refresh();
        }
        return;
      }
      totals = {
        created: totals.created + r.created,
        skipped: totals.skipped + r.skipped,
        multiPhone: totals.multiPhone + r.multiPhone,
        folderId: r.folderId ?? totals.folderId,
      };
    }
    setProgress(null);
    setStopped(null);
    setResult({ ok: true, ...totals });
    router.refresh();
  }

  function submit() {
    if (!hasName) {
      setError(t("needName"));
      return;
    }
    setError(null);
    setResult(null);
    const payload = buildRows();
    if (payload.length > MAX_ROWS_TOTAL) {
      setResult({ ok: false, error: "too_many" });
      return;
    }
    start(() => runParts(payload, 0, NO_TOTALS));
  }

  function resume() {
    if (!stopped) return;
    const { payload, at, ...totals } = stopped;
    setStopped(null);
    start(() => runParts(payload, at, totals));
  }

  const rowCount = rows.length;

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
      >
        <Upload className="size-4" />
        {t("button")}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
              <button
                type="button"
                tabIndex={-1}
                aria-label={t("close")}
                onClick={() => (pending ? null : setOpen(false))}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm motion-safe:animate-overlay-in"
              />
              <div className="glass-strong relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/15 shadow-2xl motion-safe:animate-dialog-in">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="size-5 text-brand" />
                    <h2 className="text-base font-semibold">{t("title")}</h2>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="text-muted-foreground hover:text-foreground">
                    <X className="size-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {result?.ok ? (
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                      <div className="flex size-12 items-center justify-center rounded-full bg-green-500/15 text-green-600">
                        <Upload className="size-6" />
                      </div>
                      <p className="text-sm">{t("done", { created: result.created, skipped: result.skipped })}</p>
                      {result.multiPhone > 0 ? (
                        <p className="text-sm text-muted-foreground">{t("multiPhone", { n: result.multiPhone })}</p>
                      ) : null}
                      <Button type="button" size="sm" onClick={() => setOpen(false)}>{t("close")}</Button>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">{t("hint")}</p>
                      {entity === "contacts" ? (
                        <p className="mt-1 text-sm text-muted-foreground">{t("hintAddressBook")}</p>
                      ) : null}

                      <div className="mt-3">
                        <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={pickFile} />
                        <button
                          type="button"
                          onClick={() => fileInput.current?.click()}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-6 text-sm text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
                        >
                          <Upload className="size-4" />
                          {fileName || t("choose")}
                        </button>
                      </div>

                      {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
                      {result && !result.ok ? (
                        <p className="mt-3 text-sm text-red-500">{t(`err.${result.error}`)}</p>
                      ) : null}
                      {stopped ? (
                        <p role="alert" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                          {t("stopped", {
                            created: stopped.created,
                            skipped: stopped.skipped,
                            at: stopped.at + 1,
                            total: stopped.payload.length,
                          })}
                        </p>
                      ) : null}

                      {headers.length > 0 ? (
                        <>
                          {preset ? (
                            <p className="mt-4 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm">
                              {t("recognized", { source: preset === "outlook" ? "outlook" : "google" })}
                            </p>
                          ) : null}
                          <p className="mt-5 text-xs font-medium text-muted-foreground">
                            {t("rowsFound", { n: rowCount })} · {t("mapTitle")}
                          </p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {headers.map((h, col) => (
                              <label key={`${h}-${col}`} className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-sm">
                                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={h}>{h || `#${col + 1}`}</span>
                                <span aria-hidden className="text-muted-foreground/50">→</span>
                                <select
                                  value={mapping[col] ?? ""}
                                  onChange={(e) =>
                                    setMapping((m) => m.map((v, i) => (i === col ? (e.target.value || null) : v)))
                                  }
                                  className="h-8 rounded-md border border-border bg-card px-1.5 text-sm focus-visible:border-brand focus-visible:outline-none"
                                >
                                  <option value="">{t("ignore")}</option>
                                  {fields.map((f) => (
                                    <option key={f.key} value={f.key}>
                                      {t(`fields.${f.key}`)}{f.required ? " *" : ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ))}
                          </div>

                          {/* Preview of the first rows under the current mapping. */}
                          <p className="mt-5 text-xs font-medium text-muted-foreground">
                            {t("previewTitle", { n: Math.min(5, rowCount), total: rowCount })}
                          </p>
                          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-muted/40 text-muted-foreground">
                                <tr>
                                  {mapping.map((field, col) =>
                                    field ? <th key={col} className="whitespace-nowrap px-2 py-1.5 font-medium">{t(`fields.${field}`)}</th> : null,
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.slice(0, 5).map((r, ri) => (
                                  <tr key={ri} className="border-t border-border">
                                    {mapping.map((field, col) =>
                                      field ? <td key={col} className="max-w-[12rem] truncate px-2 py-1.5">{r[col] ?? ""}</td> : null,
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : null}
                    </>
                  )}
                </div>

                {headers.length > 0 && !result?.ok ? (
                  <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                      {t("cancel")}
                    </Button>
                    {stopped && !pending ? (
                      <Button type="button" size="sm" onClick={resume}>
                        {t("resume", { at: stopped.at + 1 })}
                      </Button>
                    ) : (
                      <Button type="button" size="sm" onClick={submit} disabled={pending || !hasName}>
                        {pending
                          ? progress
                            ? t("progress", { done: progress.done, total: progress.total })
                            : t("importing")
                          : t("importBtn", { n: rowCount })}
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
