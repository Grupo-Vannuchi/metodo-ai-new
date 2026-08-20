"use client";

import { createContext, useContext, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { NewOpportunityForm } from "@/components/crm/new-opportunity-form";

type Option = { id: string; name: string };
type ProductOption = { id: string; name: string; kind: "PRODUCT" | "SERVICE"; price: number | null };

export type OpportunityCreateOptions = {
  stages: Option[];
  companies: Option[];
  contacts: Option[];
  members: Option[];
  productServices: ProductOption[];
  isMemberRole: boolean;
};

type Ctx = { enabled: boolean; open: (stageId?: string) => void };

const OppCreateCtx = createContext<Ctx>({ enabled: false, open: () => {} });

/** Access the shared "create opportunity" drawer (e.g. per-column quick-add). */
export function useOpportunityCreate(): Ctx {
  return useContext(OppCreateCtx);
}

/** Hosts a single create-opportunity drawer shared by the header button and the
 *  board columns. Wrap the board area with it. */
export function OpportunityCreateProvider({
  options,
  children,
}: {
  options: OpportunityCreateOptions;
  children: React.ReactNode;
}) {
  const t = useTranslations("crm.board");
  const [open, setOpen] = useState(false);
  const [stageId, setStageId] = useState<string | undefined>(undefined);

  const openCreate = (sid?: string) => {
    setStageId(sid);
    setOpen(true);
  };

  return (
    <OppCreateCtx.Provider value={{ enabled: true, open: openCreate }}>
      {children}
      <Drawer open={open} onClose={() => setOpen(false)} title={t("newOpportunity")}>
        {/* Remounted each open (Drawer unmounts children when closed) so drafts
            reset and the chosen stage applies via defaultValues. */}
        <NewOpportunityForm
          stages={options.stages}
          companies={options.companies}
          contacts={options.contacts}
          members={options.members}
          productServices={options.productServices}
          isMemberRole={options.isMemberRole}
          initialStageId={stageId}
          onCreated={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </Drawer>
    </OppCreateCtx.Provider>
  );
}

/** Header trigger for the shared create-opportunity drawer. */
export function OpportunityCreateButton({ label, className }: { label: string; className?: string }) {
  const { open } = useOpportunityCreate();
  return (
    <button type="button" onClick={() => open()} className={cn(buttonVariants(), className)}>
      <Plus className="size-4" />
      {label}
    </button>
  );
}
