"use client";

import { usePaged, Pager } from "@/components/ui/client-pager";

export type AuditRow = {
  id: string;
  when: string;
  who: string;
  /** Localized action label, or null when the code is unknown (shown raw). */
  action: string | null;
  actionRaw: string;
  entity: string;
};

const PAGE_SIZE = 15;

/**
 * Paginated audit-log table. The server pre-formats the rows (localized labels +
 * dates); this splits them into pages so the log never overflows the screen.
 */
export function AuditTable({
  rows,
  labels,
}: {
  rows: AuditRow[];
  labels: { when: string; who: string; action: string; entity: string };
}) {
  const { pageItems, page, setPage, totalPages } = usePaged(rows, PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      <div className="glass overflow-x-auto rounded-xl border border-border shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">{labels.when}</th>
              <th className="px-5 py-3 font-medium">{labels.who}</th>
              <th className="px-5 py-3 font-medium">{labels.action}</th>
              <th className="px-5 py-3 font-medium">{labels.entity}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-5 py-3 text-muted-foreground">{r.when}</td>
                <td className="px-5 py-3">{r.who}</td>
                <td className="px-5 py-3">
                  {r.action ? r.action : <span className="font-mono text-xs text-muted-foreground">{r.actionRaw}</span>}
                </td>
                <td className="px-5 py-3 text-muted-foreground">{r.entity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}
