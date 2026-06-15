/**
 * Turn an arbitrary string into a URL-safe slug (strips diacritics, lowercases,
 * collapses non-alphanumerics to single hyphens). Pure function, safe anywhere.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (combining marks)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
