"use client";

import { useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Spinner } from "@/components/ui/spinner";
import { createProposalFromTemplate } from "@/app/actions/proposals";

/** Row action on the templates list: generate a draft proposal and open it. */
export function UseTemplateButton({ id }: { id: string }) {
  const t = useTranslations("proposalTemplates");
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        start(async () => {
          const r = await createProposalFromTemplate({ templateId: id });
          if (r.ok) {
            router.push(`/app/proposals/${r.id}`);
            router.refresh();
          }
        });
      }}
      title={t("use")}
      className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/10 disabled:opacity-50"
    >
      {pending ? <Spinner className="size-3.5" /> : <ArrowRight className="size-3.5" />}
      {t("use")}
    </button>
  );
}
