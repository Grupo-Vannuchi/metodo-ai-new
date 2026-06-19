"use client";

import { useTransition } from "react";
import { Check, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { toggleTask } from "@/app/actions/tasks";

/** Toggle a task done / reopen from the read-only task view. */
export function TaskDoneButton({ id, done }: { id: string; done: boolean }) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant={done ? "outline" : "primary"}
      disabled={pending}
      onClick={() => start(async () => {
        await toggleTask(id, !done);
        router.refresh();
      })}
    >
      {done ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
      {done ? t("reopen") : t("complete")}
    </Button>
  );
}
