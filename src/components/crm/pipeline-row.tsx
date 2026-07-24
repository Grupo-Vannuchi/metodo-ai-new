"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Star, ChevronRight, Check, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Input } from "@/components/ui/field";
import { renamePipeline } from "@/app/actions/pipelines";

/** How long to wait for a possible second click before treating it as a plain
 * click. Long enough to catch a deliberate double-click, short enough that
 * opening a funnel still feels immediate. */
const DOUBLE_CLICK_MS = 220;

/**
 * A funnel row: click the name to open it, double-click to rename it in place.
 *
 * Both gestures live on the same element, so the single click is deferred by
 * `DOUBLE_CLICK_MS` — otherwise navigation would fire on the first click and
 * the second one would never arrive. The rest of the row navigates instantly.
 */
export function PipelineRow({
  id,
  name,
  isDefault,
  stageCount,
}: {
  id: string;
  name: string;
  isDefault: boolean;
  stageCount: number;
}) {
  const t = useTranslations("crm.pipelines");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const href = `/app/crm/pipelines/${id}`;

  // A pending single-click must not fire after the row unmounts.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Adopt a rename made elsewhere (server refresh) while not editing.
  const [prevName, setPrevName] = useState(name);
  if (prevName !== name) {
    setPrevName(name);
    if (!editing) setValue(name);
  }

  function onNameClick(e: React.MouseEvent) {
    e.preventDefault();
    if (editing || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      router.push(href);
    }, DOUBLE_CLICK_MS);
  }

  function onNameDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setValue(name);
    setError(null);
    setEditing(true);
  }

  function save() {
    const next = value.trim();
    if (!next || next === name) {
      setEditing(false);
      setValue(name);
      return;
    }
    start(async () => {
      const r = await renamePipeline(id, { name: next });
      if (r.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(t(`error.${r.error}`));
      }
    });
  }

  function cancel() {
    setEditing(false);
    setValue(name);
    setError(null);
  }

  if (editing) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 last:border-0">
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            autoFocus
            value={value}
            disabled={pending}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && cancel()}
            onBlur={save}
            aria-label={t("name")}
            className="h-9 max-w-xs"
          />
          <button type="submit" disabled={pending} className="text-muted-foreground hover:text-foreground" aria-label={t("save")}>
            <Check className="size-4" />
          </button>
          {/* onMouseDown: fires before the input's blur, which would save. */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              cancel();
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("cancel")}
          >
            <X className="size-4" />
          </button>
          {error ? <span className="truncate text-xs text-red-500">{error}</span> : null}
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between border-b border-border transition-colors last:border-0 hover:bg-muted/40">
      <span
        role="button"
        tabIndex={0}
        onClick={onNameClick}
        onDoubleClick={onNameDoubleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            router.push(href);
          }
          if (e.key === "F2") {
            e.preventDefault();
            onNameDoubleClick(e as unknown as React.MouseEvent);
          }
        }}
        title={t("renameHint")}
        className="flex min-w-0 flex-1 select-none items-center gap-2 px-5 py-4 text-left"
      >
        <span className="truncate font-medium">{name}</span>
        {isDefault ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
            <Star className="size-3" />
            {t("isDefault")}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={() => router.push(href)}
        aria-label={t("backBoard")}
        className="flex shrink-0 items-center gap-3 px-5 py-4 text-sm text-muted-foreground"
      >
        <span>{t("stageCount", { n: stageCount })}</span>
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
