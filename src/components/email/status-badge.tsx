import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  QUEUED: "bg-muted text-muted-foreground",
  SENDING: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  SENT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  PAUSED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  COMPLAINED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  DONE: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  DELIVERED: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  BOUNCED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

/** Status pill for broadcasts and recipients (label already translated). */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STYLES[status] ?? STYLES.DRAFT)}>
      {label}
    </span>
  );
}
