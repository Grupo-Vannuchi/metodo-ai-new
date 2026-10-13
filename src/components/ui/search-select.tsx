"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { searchOptions } from "@/lib/search-options";

type Option = { id: string; name: string };

/**
 * A select whose list only appears while typing: the field shows the chosen
 * name, typing filters the options (case/accent-insensitive), and leaving
 * without picking restores the choice — or clears it when the text was erased
 * and `clearable` is on. Enter never submits the form while the list is open.
 */
export function SearchSelect({
  id,
  options,
  value,
  onChange,
  clearable = true,
}: {
  id: string;
  options: readonly Option[];
  value: string;
  onChange: (id: string) => void;
  clearable?: boolean;
}) {
  const t = useTranslations("common.searchSelect");
  const listId = useId();
  // null = not editing, so the field shows the chosen option's name.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.id === value) ?? null;
  const { matches, more } = useMemo(() => searchOptions(options, query ?? ""), [options, query]);
  const open = query !== null && query.trim() !== "";
  const text = query ?? selected?.name ?? "";

  function pick(o: Option) {
    onChange(o.id);
    setQuery(null);
    setActive(0);
  }

  function leave() {
    if (query !== null && query.trim() === "" && clearable) onChange("");
    setQuery(null);
    setActive(0);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={t("placeholder")}
        value={text}
        className={clearable && selected ? "pr-10" : undefined}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onBlur={leave}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && open && matches.length > 0) {
            e.preventDefault();
            setActive((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp" && open && matches.length > 0) {
            e.preventDefault();
            setActive((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            if (matches[active]) pick(matches[active]);
          } else if (e.key === "Escape" && query !== null) {
            e.preventDefault();
            setQuery(null);
            setActive(0);
          }
        }}
      />
      {clearable && selected && query === null ? (
        <button
          type="button"
          aria-label={t("clear")}
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      ) : null}
      {open ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <ul id={listId} role="listbox">
            {matches.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={cn("cursor-pointer truncate px-4 py-2 text-sm", i === active && "bg-muted")}
              >
                {o.name}
              </li>
            ))}
          </ul>
          {matches.length === 0 ? (
            <p className="px-4 py-2 text-sm text-muted-foreground">{t("noResults")}</p>
          ) : more ? (
            <p className="border-t border-border px-4 py-1.5 text-xs text-muted-foreground">{t("keepTyping")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
