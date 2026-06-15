import { defineRouting } from "next-intl/routing";
import { hasLocale } from "next-intl";

/**
 * Single source of truth for the locales the app supports.
 * Add a locale here, add a matching message catalog in `src/messages/`, and add
 * the locale key to every bilingual DB value — nothing else needs to change.
 */
export const locales = ["pt", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "pt";

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Default locale is served without a prefix ("/"), others are prefixed ("/en").
  localePrefix: "as-needed",
});

/**
 * Narrows the raw `params.locale` string (typed by Next as `string`) to our
 * `Locale` union, falling back to the default locale. Use at the top of every
 * localized page/layout before calling next-intl APIs.
 */
export function resolveLocale(value: string): Locale {
  return hasLocale(locales, value) ? value : defaultLocale;
}
