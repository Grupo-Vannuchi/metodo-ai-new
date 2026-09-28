import type { ReactNode } from "react";
import type { Locale } from "@/i18n/routing";
import { siteConfig } from "@/config/site";

/**
 * Long-form legal page (privacy policy, terms) rendered from a per-locale JSON
 * file in `src/messages/legal/`. Those files stay out of the main catalogs on
 * purpose: `NextIntlClientProvider` ships the whole catalog to the browser on
 * every page, and legal copy is tens of KB that only this page needs.
 *
 * Inline syntax inside any string: `**bold**`; e-mails and `https://` URLs
 * become links; `{email}`, `{legalName}`, `{tradeName}`, `{cnpj}` and
 * `{address}` are filled from `siteConfig`, so company data has one source.
 */
export type LegalBlock =
  | { p: string }
  | { h3: string }
  | { ul: string[] }
  | { ol: string[] }
  | { table: { head: string[]; rows: string[][] } };

export type LegalContent = {
  title: string;
  description: string;
  updatedLabel: string;
  tocTitle: string;
  /** `id` is the anchor (`/privacy#<id>`) — keep it identical across locales. */
  sections: { id: string; title: string; blocks: LegalBlock[] }[];
};

const VARS: Record<string, string | undefined> = {
  email: siteConfig.contact.email,
  legalName: siteConfig.legalName,
  tradeName: siteConfig.tradeName,
  cnpj: siteConfig.registration,
  address: siteConfig.address,
};

const LINK = "font-medium text-brand underline underline-offset-4 break-all";
const TOKEN = /\*\*(.+?)\*\*|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(https?:\/\/[^\s)]+)/g;

/** Unknown placeholders are left as-is so a typo shows up on the page. */
function fill(text: string): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => VARS[key] ?? match);
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [whole, bold, email, url] = m;
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    if (bold !== undefined) {
      out.push(
        <strong key={start} className="font-semibold">
          {inline(bold)}
        </strong>,
      );
    } else if (email) {
      out.push(
        <a key={start} href={`mailto:${email}`} className={LINK}>
          {email}
        </a>,
      );
    } else {
      // Trailing punctuation belongs to the sentence, not the URL.
      const href = url.replace(/[.,;:]+$/, "");
      out.push(
        <a key={start} href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
          {href}
        </a>,
      );
      if (href.length < url.length) out.push(url.slice(href.length));
    }
    last = start + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const text = (s: string) => inline(fill(s));

function Block({ block }: { block: LegalBlock }) {
  if ("p" in block) return <p>{text(block.p)}</p>;
  if ("h3" in block) return <h3 className="mt-2 font-semibold">{text(block.h3)}</h3>;
  if ("ul" in block || "ol" in block) {
    const ordered = "ol" in block;
    const items = ordered ? block.ol : block.ul;
    const List = ordered ? "ol" : "ul";
    return (
      <List className={`flex flex-col gap-1.5 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
        {items.map((item, i) => (
          <li key={i}>{text(item)}</li>
        ))}
      </List>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50">
          <tr>
            {block.table.head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-semibold">
                {text(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row, r) => (
            <tr key={r} className="border-t border-border">
              {row.map((cell, c) => (
                <td key={c} className="px-3 py-2 align-top">
                  {text(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LegalDocument({
  content,
  locale,
  updatedAt,
}: {
  content: LegalContent;
  locale: Locale;
  /** ISO date (`YYYY-MM-DD`) of the last change to the text. */
  updatedAt: string;
}) {
  const updated = new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${updatedAt}T00:00:00Z`));

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{content.title}</h1>
        <p className="text-sm text-muted-foreground">
          {content.updatedLabel}: <time dateTime={updatedAt}>{updated}</time>
        </p>
      </header>

      <nav aria-label={content.tocTitle} className="mt-8 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-semibold">{content.tocTitle}</p>
        <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          {content.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-muted-foreground hover:text-foreground">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 flex flex-col gap-10">
        {content.sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-20">
            <h2 className="text-xl font-semibold tracking-tight">{s.title}</h2>
            <div className="mt-3 flex flex-col gap-3 leading-relaxed">
              {s.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
