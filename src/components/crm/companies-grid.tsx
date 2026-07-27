"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2, Phone, Mail, MapPin, Building2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useUndo } from "@/components/ui/undo";
import { StartChatButton } from "@/components/inbox/start-chat-button";
import { FolderExplorer, type FolderColumn, type ExplorerLabels } from "@/components/crm/folder-explorer";
import { BulkBar } from "@/components/crm/bulk-bar";
import { createCompanyFolder, renameCompanyFolder, deleteCompanyFolder, moveCompanyToFolder } from "@/app/actions/company-folders";
import { deleteCompany } from "@/app/actions/companies";
import { bulkDeleteCompanies, bulkMoveCompanies } from "@/app/actions/bulk";
import type { CompanyCard, CompanyColumn } from "@/lib/queries/company-folders";

const GRID_CLS = "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]";

type ListLabels = { name: string; cnpj: string; city: string; email: string; select: string };

/** A folder's companies as summary cards (grid) or a detailed list. */
function CompanyList({
  companies,
  view,
  onDragStart,
  onDragEnd,
  onOpen,
  onDelete,
  deleteLabel,
  labels,
  selected,
  onToggleSelect,
}: {
  companies: CompanyCard[];
  view: "grid" | "list";
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  deleteLabel: string;
  labels: ListLabels;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const openCard = (e: React.MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    onOpen(id);
  };
  const checkbox = (id: string) => (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => onToggleSelect(id)}
      onClick={(e) => e.stopPropagation()}
      aria-label={labels.select}
      className="size-4 shrink-0 cursor-pointer accent-[var(--brand)]"
    />
  );
  const actions = (card: CompanyCard) => (
    <div className="flex shrink-0 items-center" onPointerDown={(e) => e.stopPropagation()}>
      {card.phone ? <StartChatButton phone={card.phone} name={card.name} iconOnly /> : null}
      <button
        type="button"
        onClick={() => onDelete(card.id)}
        className="rounded-lg px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
        aria-label={deleteLabel}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );

  if (view === "list") {
    return (
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="hidden items-center gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:flex">
          <span className="flex-1">{labels.name}</span>
          <span className="w-40 shrink-0">{labels.cnpj}</span>
          <span className="w-32 shrink-0">{labels.city}</span>
          <span className="w-52 shrink-0">{labels.email}</span>
          <span className="w-16 shrink-0" />
        </div>
        <div className="flex flex-col">
          {companies.map((card) => (
            <div
              key={card.id}
              data-select-id={card.id}
              draggable
              onDragStart={() => onDragStart(card.id)}
              onDragEnd={onDragEnd}
              onClick={(e) => openCard(e, card.id)}
              className={cn(
                "flex cursor-pointer select-none items-center gap-3 border-b border-border px-3 py-2 transition-colors last:border-0 hover:bg-muted/40 active:cursor-grabbing",
                selected.has(card.id) && "bg-brand/5",
              )}
            >
              {checkbox(card.id)}
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Building2 className="size-4" />
                </span>
                <span className="truncate text-sm font-medium">{card.name}</span>
              </div>
              <span className="hidden w-40 shrink-0 truncate text-xs text-muted-foreground sm:block">{card.cnpj ?? "—"}</span>
              <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground sm:block">{card.city ?? "—"}</span>
              <span className="hidden w-52 shrink-0 truncate text-xs text-muted-foreground sm:block">{card.email ?? "—"}</span>
              <div className="w-16 shrink-0">{actions(card)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={GRID_CLS}>
      {companies.map((card) => (
        <div
          key={card.id}
          data-select-id={card.id}
          draggable
          onDragStart={() => onDragStart(card.id)}
          onDragEnd={onDragEnd}
          onClick={(e) => openCard(e, card.id)}
          className={cn(
            "hover-lift cursor-pointer select-none rounded-xl border bg-card p-3 shadow-sm active:cursor-grabbing",
            selected.has(card.id) ? "border-brand ring-1 ring-brand" : "border-border",
          )}
        >
          <div className="flex items-start gap-3">
            <div className="pt-0.5">{checkbox(card.id)}</div>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Building2 className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{card.name}</p>
              {card.cnpj ? <p className="truncate text-xs text-muted-foreground">{card.cnpj}</p> : null}
            </div>
            {actions(card)}
          </div>
          {card.phone || card.email || card.city ? (
            <div className="mt-2.5 flex flex-col gap-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
              {card.phone ? (
                <span className="flex items-center gap-1.5">
                  <Phone className="size-3 shrink-0" />
                  <span className="truncate">{card.phone}</span>
                </span>
              ) : null}
              {card.email ? (
                <span className="flex items-center gap-1.5">
                  <Mail className="size-3 shrink-0" />
                  <span className="truncate">{card.email}</span>
                </span>
              ) : null}
              {card.city ? (
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-3 shrink-0" />
                  <span className="truncate">{card.city}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function CompaniesGrid({ columns }: { columns: CompanyColumn[] }) {
  const t = useTranslations("crm.companies");
  const tc = useTranslations("crm.common");
  const router = useRouter();
  const undo = useUndo();

  // Ids hidden optimistically while an undoable delete is pending (see contacts-grid).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [prevColumns, setPrevColumns] = useState(columns);
  if (prevColumns !== columns) {
    setPrevColumns(columns);
    const present = new Set(columns.flatMap((c) => c.companies.map((x) => x.id)));
    setHidden((prev) => new Set([...prev].filter((id) => present.has(id))));
  }

  const cols: FolderColumn<CompanyCard>[] = columns.map((c) => ({
    id: c.id,
    name: c.name,
    items: c.companies.filter((x) => !hidden.has(x.id)),
  }));

  function deleteWithUndo(ids: string[], commit: () => Promise<unknown>) {
    setHidden((prev) => new Set([...prev, ...ids]));
    undo({
      message: ids.length === 1 ? tc("deleted") : tc("deletedN", { count: ids.length }),
      commit: async () => {
        await commit();
        router.refresh();
      },
      onUndo: () =>
        setHidden((prev) => {
          const n = new Set(prev);
          ids.forEach((id) => n.delete(id));
          return n;
        }),
    });
  }

  const labels: ExplorerLabels = {
    newFolder: t("newFolder"),
    folderName: t("folderName"),
    addFolder: t("addFolder"),
    cancel: t("cancel"),
    viewGrid: t("viewGrid"),
    viewList: t("viewList"),
    unfiled: t("unfiled"),
    openHint: t("folderOpenHint"),
    emptyFolder: t("emptyFolder"),
    renameFolder: t("renameFolder"),
    deleteFolder: t("deleteFolder"),
    confirmDeleteFolder: t("confirmDeleteFolder"),
    save: t("save"),
    dragHint: tc("dragHint"),
    folderCount: (count) => t("folderCount", { count }),
  };
  const listLabels: ListLabels = { name: t("name"), cnpj: t("cnpj"), city: t("city"), email: t("email"), select: tc("select") };

  const onDeleteCompany = (id: string) => deleteWithUndo([id], () => deleteCompany(id));

  return (
    <FolderExplorer<CompanyCard>
      storageKey="companies"
      columns={cols}
      labels={labels}
      onCreateFolder={(name) => createCompanyFolder({ name })}
      onRenameFolder={(id, name) => renameCompanyFolder(id, { name })}
      onDeleteFolder={(id) => deleteCompanyFolder(id)}
      onMoveItem={(id, folderId) => moveCompanyToFolder(id, folderId)}
      renderItems={({ items, view, onDragStart, onDragEnd, selected, onToggleSelect }) => (
        <CompanyList
          companies={items}
          view={view}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onOpen={(id) => router.push(`/app/companies/${id}`)}
          onDelete={onDeleteCompany}
          deleteLabel={tc("delete")}
          labels={listLabels}
          selected={selected}
          onToggleSelect={onToggleSelect}
        />
      )}
      renderBulkBar={({ ids, folders, clear }) => (
        <BulkBar
          count={ids.length}
          folders={folders}
          onMove={async (folderId) => {
            await bulkMoveCompanies(ids, folderId);
            clear();
            router.refresh();
          }}
          onDelete={async () => {
            clear();
            deleteWithUndo(ids, () => bulkDeleteCompanies(ids));
          }}
          onClear={clear}
        />
      )}
    />
  );
}
