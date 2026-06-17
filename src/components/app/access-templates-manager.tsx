"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  createAccessTemplate,
  updateAccessTemplate,
  deleteAccessTemplate,
} from "@/app/actions/access";

type Tpl = { id: string; name: string; screens: string[]; memberCount: number };
type Result = { ok: boolean; error?: string };

export function AccessTemplatesManager({
  templates,
  screens,
}: {
  templates: Tpl[];
  screens: string[];
}) {
  const t = useTranslations("access");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  function run(fn: () => Promise<Result>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(t(`error.${r.error ?? "unknown"}`));
      router.refresh();
    });
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    run(() => createAccessTemplate({ name, screens: [] }));
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onCreate} className="flex items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("namePlaceholder")}
          className="h-10 max-w-xs"
        />
        <Button type="submit" disabled={pending}>
          <Plus className="size-4" />
          {t("create")}
        </Button>
      </form>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      {templates.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((tpl) => (
            <TemplateCard key={tpl.id} tpl={tpl} screens={screens} pending={pending} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  tpl,
  screens,
  pending,
  run,
}: {
  tpl: Tpl;
  screens: string[];
  pending: boolean;
  run: (fn: () => Promise<Result>) => void;
}) {
  const t = useTranslations("access");
  const nav = useTranslations("app.nav");
  const [name, setName] = useState(tpl.name);
  const [selected, setSelected] = useState<Set<string>>(new Set(tpl.screens));

  function toggle(screen: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(screen)) next.delete(screen);
      else next.add(screen);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 font-medium" />
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(t("confirmDelete"))) run(() => deleteAccessTemplate(tpl.id));
          }}
          aria-label={t("delete")}
          className="shrink-0 rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {screens.map((s) => (
          <label key={s} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm", selected.has(s) ? "bg-brand/10" : "hover:bg-muted")}>
            <input
              type="checkbox"
              className="size-4 accent-brand"
              checked={selected.has(s)}
              onChange={() => toggle(s)}
            />
            {nav(s)}
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t("memberCount", { count: tpl.memberCount })}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => updateAccessTemplate(tpl.id, { name: name.trim(), screens: [...selected] }))}
        >
          <Save className="size-4" />
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
