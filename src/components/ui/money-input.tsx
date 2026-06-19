"use client";

import { useState } from "react";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const fmt = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Currency input (BRL). Masks as the user types — digits fill from the cents up
 * ("123456" → "1.234,56"). Submits the clean dot-decimal number:
 * - pass `name` to emit a hidden field for FormData submission;
 * - pass `onValueChange` to wire it into react-hook-form (`setValue`).
 */
export function MoneyInput({
  id,
  name,
  defaultValue = 0,
  required,
  className,
  onValueChange,
}: {
  id?: string;
  name?: string;
  defaultValue?: number;
  required?: boolean;
  className?: string;
  onValueChange?: (value: number) => void;
}) {
  const [cents, setCents] = useState(() => Math.round((defaultValue || 0) * 100));

  function handle(input: string) {
    const digits = input.replace(/\D/g, "").slice(0, 13);
    const next = digits ? parseInt(digits, 10) : 0;
    setCents(next);
    onValueChange?.(next / 100);
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        R$
      </span>
      <Input
        id={id}
        inputMode="numeric"
        value={cents === 0 ? "" : fmt(cents)}
        onChange={(e) => handle(e.target.value)}
        placeholder="0,00"
        required={required}
        className={cn("pl-9", className)}
      />
      {name ? <input type="hidden" name={name} value={(cents / 100).toFixed(2)} /> : null}
    </div>
  );
}
