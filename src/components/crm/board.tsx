"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Eye } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { moveOpportunity } from "@/app/actions/opportunities";
import { StartChatButton } from "@/components/inbox/start-chat-button";
import type { BoardColumn } from "@/lib/queries/crm";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function Board({ columns }: { columns: BoardColumn[] }) {
  const t = useTranslations("crm.board");
  const router = useRouter();
  const [cols, setCols] = useState(columns);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [, start] = useTransition();

  // Adopt fresh server data when the prop changes (after router.refresh
  // reconciles the optimistic move) — the React "derive state from props"
  // pattern, done during render rather than in an effect.
  const [prevColumns, setPrevColumns] = useState(columns);
  if (prevColumns !== columns) {
    setPrevColumns(columns);
    setCols(columns);
  }

  function findCard(id: string) {
    for (const c of cols) {
      const card = c.cards.find((x) => x.id === id);
      if (card) return { card, fromColumnId: c.id };
    }
    return null;
  }

  function onDrop(toColumnId: string) {
    setOverCol(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;

    const found = findCard(id);
    if (!found || found.fromColumnId === toColumnId) return;

    // Optimistic local move.
    setCols((prev) =>
      prev.map((c) => {
        if (c.id === found.fromColumnId) {
          return { ...c, cards: c.cards.filter((x) => x.id !== id) };
        }
        if (c.id === toColumnId) {
          return { ...c, cards: [...c.cards, found.card] };
        }
        return c;
      }),
    );

    start(async () => {
      await moveOpportunity({ opportunityId: id, toStageId: toColumnId });
      router.refresh();
    });
  }

  const lastIndex = cols.length - 1;

  return (
    // Horizontal timeline: a single row of fixed-width stages that scrolls
    // sideways. A numbered rail across the top connects the stages; each stage
    // is a tall column so cards stay easy to read.
    <div className="overflow-x-auto pb-4">
      <div className="flex min-w-max">
        {cols.map((col, i) => {
          const total = col.cards.reduce((sum, c) => sum + c.value, 0);
          return (
            <div key={col.id} className="flex w-72 shrink-0 flex-col">
              {/* Timeline rail + node (flush between columns = continuous line) */}
              <div className="flex items-center">
                <div className={cn("h-0.5 flex-1 bg-border", i === 0 && "opacity-0")} />
                <span className="flex size-7 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">
                  {i + 1}
                </span>
                <div className={cn("h-0.5 flex-1 bg-border", i === lastIndex && "opacity-0")} />
              </div>

              <div className="mb-3 mt-2 flex items-center justify-center gap-2 text-center">
                <span className="text-sm font-semibold">{col.name}</span>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">
                  {col.cards.length}
                </span>
              </div>

              {/* Tall droppable card area (inset so columns don't touch). */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(col.id);
                }}
                onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
                onDrop={() => onDrop(col.id)}
                className={cn(
                  "mx-2 flex min-h-[60vh] flex-1 flex-col gap-2 rounded-xl border bg-muted/30 p-3 transition-colors",
                  overCol === col.id ? "border-brand bg-brand/5" : "border-border",
                )}
              >
                {col.cards.map((card) => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => setDragId(null)}
                    className="cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {card.code ? (
                          <p className="text-[11px] font-medium tabular-nums text-muted-foreground">{card.code}</p>
                        ) : null}
                        <p className="text-sm font-medium">{card.title}</p>
                      </div>
                      <div className="flex shrink-0 items-center" onPointerDown={(e) => e.stopPropagation()}>
                        {card.contactPhone ? (
                          <StartChatButton
                            phone={card.contactPhone}
                            name={card.contactName ?? undefined}
                            contactId={card.contactId ?? undefined}
                            iconOnly
                          />
                        ) : null}
                        <Link
                          href={`/app/crm/${card.id}`}
                          className="text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={t("open")}
                        >
                          <Eye className="size-3.5" />
                        </Link>
                      </div>
                    </div>
                    {card.companyName ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{card.companyName}</p>
                    ) : null}
                    <p className="mt-2 text-sm font-semibold text-brand">{brl.format(card.value)}</p>
                  </div>
                ))}
                {col.cards.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("emptyColumn")}
                  </p>
                ) : null}
              </div>

              <p className="mx-2 mt-3 px-1 text-xs text-muted-foreground">
                {t("columnTotal", { total: brl.format(total) })}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
