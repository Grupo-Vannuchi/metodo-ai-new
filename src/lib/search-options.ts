/** Most results a type-ahead list shows at once. */
export const SEARCH_LIMIT = 8;

/** Lowercase, no accents, whitespace folded — "  João  " and "joao" compare equal. */
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Options whose name contains the query, ignoring case and accents. A blank
 * query matches nothing (the list only appears while typing). Names that start
 * with the query come first; otherwise the input order is kept. `more` says
 * the list was cut at `limit`.
 */
export function searchOptions<T extends { name: string }>(
  options: readonly T[],
  query: string,
  limit: number = SEARCH_LIMIT,
): { matches: T[]; more: boolean } {
  const q = normalizeSearch(query);
  if (!q) return { matches: [], more: false };
  const starts: T[] = [];
  const contains: T[] = [];
  for (const o of options) {
    const name = normalizeSearch(o.name);
    if (name.startsWith(q)) starts.push(o);
    else if (name.includes(q)) contains.push(o);
  }
  const all = [...starts, ...contains];
  return { matches: all.slice(0, limit), more: all.length > limit };
}
