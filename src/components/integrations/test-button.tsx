"use client";

import { useTransition } from "react";
import { Plug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { testConnection } from "@/app/actions/connections";

export function TestButton({ id }: { id: string }) {
  const t = useTranslations("connections");
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await testConnection(id);
          router.refresh();
        })
      }
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <Plug className="size-4" />
      {pending ? t("testing") : t("test")}
    </button>
  );
}
