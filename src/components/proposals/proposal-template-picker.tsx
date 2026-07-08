"use client";

import { useState, useTransition } from "react";
import { LayoutTemplate, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { createProposalFromTemplate } from "@/app/actions/proposals";

const selectCls = cn(
  "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

/**
 * "Start from a template" card on the New Proposal page. Picking a template
 * generates a pre-filled draft (merging the opportunity's client data when
 * present) and opens it.
 */
export function ProposalTemplatePicker({
  templates,
  opportunityId,
}: {
  templates: { id: string; name: string }[];
  opportunityId?: string;
}) {
  const t = useTranslations("proposals");
  const router = useRouter();
  const [templateId, setTemplateId] = useState("");
  const [pending, start] = useTransition();

  if (templates.length === 0) return null;

  function use() {
    if (!templateId || pending) return;
    start(async () => {
      const r = await createProposalFromTemplate({ templateId, opportunityId });
      if (r.ok) {
        router.push(`/app/proposals/${r.id}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-xl border border-brand/30 bg-brand/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LayoutTemplate className="size-4 text-brand" />
        {t("startFromTemplate")}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("startFromTemplateHint")}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select
          aria-label={t("templates")}
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className={selectCls}
        >
          <option value="">{t("pickTemplate")}</option>
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={use}
          disabled={!templateId || pending}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <Spinner className="size-4" /> : <ArrowRight className="size-4" />}
          {t("useTemplate")}
        </button>
      </div>
    </div>
  );
}
