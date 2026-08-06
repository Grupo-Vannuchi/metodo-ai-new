/** Shared badge styling per purchase-order status. */
export const PURCHASE_STATUSES = ["DRAFT", "APPROVED", "ORDERED", "PARTIAL", "RECEIVED", "CANCELED"] as const;

export const statusBadgeCls: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  APPROVED: "bg-brand/10 text-brand",
  ORDERED: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  PARTIAL: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  RECEIVED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  CANCELED: "bg-red-500/10 text-red-600 dark:text-red-400",
};
