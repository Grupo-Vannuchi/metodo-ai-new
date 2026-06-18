const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Format a number as Brazilian Real (R$ 1.234,56). */
export function formatBRL(value: number): string {
  return brl.format(value);
}
