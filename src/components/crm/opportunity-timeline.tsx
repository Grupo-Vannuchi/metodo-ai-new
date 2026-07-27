import { getTranslations } from "next-intl/server";
import { Plus, FileText, CheckSquare, Square, Paperclip, Trophy, XCircle, Ban } from "lucide-react";
import type { TimelineEvent, TimelineType } from "@/lib/queries/timeline";

const ICON: Record<TimelineType, typeof Plus> = {
  created: Plus,
  proposal: FileText,
  task: Square,
  task_done: CheckSquare,
  attachment: Paperclip,
  won: Trophy,
  lost: XCircle,
  canceled: Ban,
};

const TONE: Record<TimelineType, string> = {
  created: "bg-brand/10 text-brand",
  proposal: "bg-blue-500/10 text-blue-600",
  task: "bg-muted text-muted-foreground",
  task_done: "bg-green-500/10 text-green-600",
  attachment: "bg-muted text-muted-foreground",
  won: "bg-green-500/10 text-green-600",
  lost: "bg-red-500/10 text-red-600",
  canceled: "bg-muted text-muted-foreground",
};

/**
 * Activity history for an opportunity. Server component: the events are already
 * aggregated by `getOpportunityTimeline`; this just renders the rail.
 */
export async function OpportunityTimeline({ events, locale }: { events: TimelineEvent[]; locale: string }) {
  const t = await getTranslations("crm.opportunity.timeline");
  const fmt = new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 text-sm font-semibold">{t("title")}</h2>
      {events.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="flex flex-col">
          {events.map((e, i) => {
            const Icon = ICON[e.type];
            return (
              <li key={e.key} className="flex gap-3">
                {/* Rail: icon node + connecting line. */}
                <div className="flex flex-col items-center">
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${TONE[e.type]}`}>
                    <Icon className="size-4" />
                  </span>
                  {i < events.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
                </div>
                <div className="min-w-0 flex-1 pb-5">
                  <p className="text-sm">
                    <span className="font-medium">{t(`type.${e.type}`)}</span>
                    {e.title ? <span className="text-muted-foreground"> — {e.title}</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmt.format(new Date(e.at))}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
