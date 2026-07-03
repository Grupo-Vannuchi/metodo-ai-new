import { getTranslations } from "next-intl/server";
import { StartChatButton } from "@/components/inbox/start-chat-button";
import { OpenRow } from "@/components/ui/open-row";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { BoardCard } from "@/lib/queries/crm";

export type OpportunityRow = BoardCard & { stageName: string };

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-brand/10 text-brand",
  ON_HOLD: "bg-amber-500/10 text-amber-600",
  WON: "bg-green-500/10 text-green-600",
  LOST: "bg-red-500/10 text-red-600",
  CANCELED: "bg-amber-500/10 text-amber-600",
};

/**
 * The funnel's opportunities as a table (the "list" view) — same data as the
 * Kanban, flattened. Rows open on double-click via {@link OpenRow}, matching the
 * closed-opportunities table.
 */
export async function OpportunityList({ rows }: { rows: OpportunityRow[] }) {
  const t = await getTranslations("crm.board");
  const to = await getTranslations("crm.opportunity");

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
        {t("emptyList")}
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 border-b border-border bg-card text-muted-foreground">
          <tr>
            <th className="px-5 py-3 font-medium">{t("colOpp")}</th>
            <th className="px-5 py-3 font-medium">{t("colStage")}</th>
            <th className="px-5 py-3 font-medium">{t("colStatus")}</th>
            <th className="px-5 py-3 font-medium">{t("colValue")}</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <OpenRow
              key={o.id}
              href={`/app/crm/${o.id}`}
              title={t("openHint")}
              className="border-b border-border align-top last:border-0 hover:bg-muted/40"
            >
              <td className="px-5 py-3">
                <div className="flex flex-col">
                  <span className="font-medium">
                    {o.code ? <span className="mr-2 text-xs tabular-nums text-muted-foreground">{o.code}</span> : null}
                    {o.title}
                  </span>
                  {o.companyName || o.contactName ? (
                    <span className="text-xs text-muted-foreground">
                      {[o.companyName, o.contactName].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="px-5 py-3 text-muted-foreground">{o.stageName}</td>
              <td className="px-5 py-3">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[o.status])}>
                  {to(`status${o.status}`)}
                </span>
              </td>
              <td className="px-5 py-3 font-semibold tabular-nums text-brand">{formatBRL(o.value)}</td>
              <td className="px-5 py-3">
                <div className="flex items-center justify-end">
                  {o.contactPhone ? (
                    <StartChatButton
                      phone={o.contactPhone}
                      name={o.contactName ?? undefined}
                      contactId={o.contactId ?? undefined}
                      iconOnly
                    />
                  ) : null}
                </div>
              </td>
            </OpenRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
