/**
 * ─────────────────────────────────────────────────────────────────────────
 *  MÉTODOAI — BRAND CONFIGURATION
 * ─────────────────────────────────────────────────────────────────────────
 * Single source of truth for branding: name, contact details, social links,
 * theme colours and the public navigation. Re-skinning the product = editing
 * this file. All user-facing *copy* lives in `src/messages/{locale}.json`
 * (bilingual); this file holds only brand identity and theme tokens.
 */

export type ThemePalette = {
  /** Primary brand colour (buttons, links, highlights). */
  brand: string;
  /** Readable text colour on top of `brand`. */
  brandForeground: string;
  /** Secondary accent used sparingly for emphasis. */
  accent: string;
  /** Page background and its readable foreground. */
  background: string;
  foreground: string;
};

/** Keys available under the `nav` translation namespace. */
export type NavKey = "features" | "pricing" | "contact";

export type NavItem = {
  /** Translation key under the `nav` namespace. */
  key: NavKey;
  /** Route relative to the locale root, e.g. "/pricing". */
  href: string;
};

export type SiteConfig = {
  /** Public brand name shown in the wordmark and titles. */
  name: string;
  /** Legal entity name (footer / legal copy). */
  legalName: string;
  /** Year the company was founded. */
  foundedYear: number;
  /** Company registration number (Brazil: CNPJ). Optional. */
  registration?: string;

  contact: {
    email: string;
    phone: string;
    whatsapp: {
      /** Digits only, with country code, for wa.me links. */
      number: string;
      display: string;
    };
  };

  social: {
    instagram?: string;
    linkedin?: string;
    youtube?: string;
  };

  /** Primary navigation shown in the marketing header/footer. */
  nav: NavItem[];

  theme: {
    light: ThemePalette;
    dark: ThemePalette;
  };
};

export const siteConfig: SiteConfig = {
  name: "MétodoAI",
  legalName: "MétodoAI Tecnologia LTDA",
  foundedYear: 2026,

  contact: {
    email: "contato@metodoai.com.br",
    phone: "+55 (11) 90000-0000",
    whatsapp: {
      number: "5511900000000",
      display: "(11) 90000-0000",
    },
  },

  social: {
    instagram: "https://instagram.com/metodoai",
    linkedin: "https://www.linkedin.com/company/metodoai",
  },

  nav: [
    { key: "features", href: "/#features" },
    { key: "pricing", href: "/pricing" },
    { key: "contact", href: "/#contact" },
  ],

  theme: {
    // Brand identity assimilated from the MÉTODO logo: navy blue + green accent.
    light: {
      brand: "#18375d",
      brandForeground: "#ffffff",
      accent: "#2ecc71",
      // Soft blue-tinted page background (not stark white) to ease the eyes.
      background: "#f5f7fb",
      foreground: "#0a0a0a",
    },
    dark: {
      brand: "#5b8fc7",
      brandForeground: "#0a1018",
      accent: "#2ecc71",
      background: "#0a0a0a",
      foreground: "#ededed",
    },
  },
};

/** Build a wa.me deep link with an optional pre-filled message. */
export function whatsappLink(message?: string): string {
  const base = `https://wa.me/${siteConfig.contact.whatsapp.number}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
