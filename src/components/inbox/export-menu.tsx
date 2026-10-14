"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, FileSpreadsheet, FileType, UserPlus, Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { importWhatsappContactsToCrm, type ImportLine } from "@/app/actions/inbox";
import { normalizeSearch } from "@/lib/search-options";
import { MAX_IMPORT_GROUPS } from "@/lib/whatsapp/group-import";

type Group = { id: string; name: string };

/**
 * Export the WhatsApp contact list, or a group's members, as PDF / Word / XML,
 * or add them to the CRM. Downloads take exactly one item (from
 * /api/inbox/export); "Adicionar aos contatos" takes the contact list and/or
 * up to MAX_IMPORT_GROUPS groups at once. Lives at the top of the inbox.
 *
 * The dropdown is rendered through a portal to <body>: the menu sits inside the
 * inbox's glass header, which has `overflow-hidden` + `backdrop-filter` — both
 * would clip (and re-anchor) a normal absolute/fixed child, hiding the menu.
 * Portaling escapes that; we position it under the button via a measured rect.
 */
export function ExportMenu({ groups }: { groups: Group[] }) {
  const t = useTranslations("inbox");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [contacts, setContacts] = useState(false);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [importing, startImport] = useTransition();
  const [lines, setLines] = useState<ImportLine[] | null>(null);
  const [importError, setImportError] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }

  function toggle() {
    if (!open) place();
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // A page scroll/resize would leave the fixed menu detached from the button;
    // scrolling the group list inside the menu must not close it.
    const onMove = (e: Event) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  const picked = (contacts ? 1 : 0) + groupIds.length;
  const atMax = groupIds.length >= MAX_IMPORT_GROUPS;
  const q = normalizeSearch(query);
  const shown = q ? groups.filter((g) => normalizeSearch(g.name).includes(q)) : groups;
  const nameOf = new Map(groups.map((g) => [g.id, g.name]));

  const toggleGroup = (id: string) =>
    setGroupIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  function download(format: "pdf" | "doc" | "xlsx") {
    if (picked !== 1) return;
    const params = new URLSearchParams();
    if (contacts) {
      params.set("type", "contacts");
    } else {
      params.set("type", "group");
      params.set("conversationId", groupIds[0]);
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
    setLines(null);
    setImportError(false);
    startImport(async () => {
      try {
        const r = await importWhatsappContactsToCrm({ contacts, groupIds });
        if (r.ok) {
          setLines(r.lines);
          router.refresh();
        } else {
          setImportError(true);
        }
      } catch {
        // Network blip or stale action id after a deploy.
        setImportError(true);
      }
    });
  }

  const lineText = (l: ImportLine) => {
    if (l.id === "contacts") return t("export.lineContacts", { created: l.created, skipped: l.skipped });
    const name = nameOf.get(l.id) ?? l.label;
    return l.failed
      ? t("export.lineFailed", { name })
      : t("export.line", { name, created: l.created, skipped: l.skipped });
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
      >
        <Download className="size-4" />
        {t("export.button")}
      </button>

      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              // Taller than the window → scroll inside (onMove ignores scrolls in here).
              style={{ position: "fixed", top: pos.top, right: pos.right, maxHeight: `calc(100vh - ${pos.top + 16}px)` }}
              className="z-50 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-lg"
            >
              <p className="text-xs font-medium text-muted-foreground">{t("export.target")}</p>
              <label className="mt-1.5 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-brand"
                  checked={contacts}
                  onChange={(e) => setContacts(e.target.checked)}
                />
                {t("export.allContacts")}
              </label>

              {groups.length ? (
                <div className="mt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">{t("export.groups")}</p>
                    {groupIds.length ? (
                      <button
                        type="button"
                        onClick={() => setGroupIds([])}
                        className="text-xs font-medium text-brand hover:underline"
                      >
                        {t("export.clearGroups", { count: groupIds.length })}
                      </button>
                    ) : null}
                  </div>
                  <div className="relative mt-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("export.searchGroups")}
                      aria-label={t("export.searchGroups")}
                      className="h-8 w-full rounded-md border border-border bg-card pl-7 pr-2 text-sm focus-visible:border-brand focus-visible:outline-none"
                    />
                  </div>
                  <ul className="mt-1.5 max-h-52 overflow-y-auto rounded-md border border-border py-1">
                    {shown.map((g) => {
                      const on = groupIds.includes(g.id);
                      return (
                        <li key={g.id}>
                          <label className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-muted">
                            <input
                              type="checkbox"
                              className="size-4 shrink-0 accent-brand"
                              checked={on}
                              disabled={!on && atMax}
                              onChange={() => toggleGroup(g.id)}
                            />
                            <span className="truncate">{g.name}</span>
                          </label>
                        </li>
                      );
                    })}
                    {shown.length === 0 ? (
                      <li className="px-2 py-1 text-sm text-muted-foreground">{t("export.noGroups")}</li>
                    ) : null}
                  </ul>
                  {atMax ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("export.maxGroups", { max: MAX_IMPORT_GROUPS })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <p className="mt-3 text-xs font-medium text-muted-foreground">{t("export.format")}</p>
              <div className="mt-1 grid grid-cols-3 gap-2">
                <FormatBtn icon={FileText} label="PDF" disabled={picked !== 1} onClick={() => download("pdf")} />
                <FormatBtn
                  icon={FileSpreadsheet}
                  label="Excel"
                  disabled={picked !== 1}
                  onClick={() => download("xlsx")}
                />
                <FormatBtn icon={FileType} label="Word" disabled={picked !== 1} onClick={() => download("doc")} />
              </div>
              {picked > 1 ? <p className="mt-1 text-xs text-muted-foreground">{t("export.pickOne")}</p> : null}

              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground">{t("export.crmTitle")}</p>
                <button
                  type="button"
                  onClick={importToCrm}
                  disabled={importing || picked === 0}
                  className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {importing ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                  {t("export.toCrm")}
                </button>
                {picked === 0 ? <p className="mt-1 text-xs text-muted-foreground">{t("export.pickSome")}</p> : null}
                {importError ? <p className="mt-2 text-xs text-red-600">{t("export.importError")}</p> : null}
                {lines ? (
                  <ul className="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto text-xs text-muted-foreground">
                    {lines.map((l) => (
                      <li key={l.id} className={l.failed ? "text-red-600" : undefined}>
                        {lineText(l)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function FormatBtn({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 rounded-lg border border-border px-2 py-2 text-xs transition-colors hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
