/** Shared badge styling per asset status. */
export const ASSET_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "RETIRED"] as const;

export const assetStatusCls: Record<string, string> = {
  AVAILABLE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  IN_USE: "bg-brand/10 text-brand",
  MAINTENANCE: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  RETIRED: "bg-muted text-muted-foreground",
};
