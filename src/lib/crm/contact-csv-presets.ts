/**
 * The contact files that address books export, made into the columns "Importar CSV" already understands (Nome, Telefone,
 * E-mail, Empresa, Cargo, Tags), so the person exports and imports without touching the spreadsheet. Pure and client-safe:
 * the import modal runs it right after parsing.
 *
 * - google: the current "CSV do Google" of Google Contatos (First Name / Last Name, "Phone 1 - Value"…, Labels).
 * - google-legacy: the older Google CSV (Name / Given Name / Family Name, "Phone 1 - Type", Group Membership).
 * - outlook: the "CSV do Outlook" (Google exports it too): First Name / Last Name, "E-mail Address", "Mobile Phone"…
 *
 * Google puts several values of one field in one cell joined by " ::: " and lists the system groups as "* myContacts",
 * "* starred": the first are split, the second dropped. Of the phones, a mobile one (by its label) wins, since what the
 * import is for is WhatsApp; else the first. Anything else is left as it came (preset null).
 */

export type CsvTable = { headers: string[]; rows: string[][] };
export type ContactCsvPreset = "google" | "google-legacy" | "outlook";

const OUT_HEADERS = ["Nome", "Telefone", "E-mail", "Empresa", "Cargo", "Tags"];
const MOBILE_LABEL = /mobile|celular|\bcel\b|whatsapp/i;
const PHONE_VALUE = /^phone (\d+) - value$/;
const EMAIL_VALUE = /^e-mail (\d+) - value$/;
/** The phones of an Outlook file, best first for WhatsApp. */
const OUTLOOK_PHONES = ["mobile phone", "primary phone", "business phone", "home phone", "business phone 2", "home phone 2", "other phone", "car phone"];
const OUTLOOK_EMAILS = ["e-mail address", "e-mail 2 address", "e-mail 3 address"];

const key = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase();
const split = (v: string) => v.split(":::").map((s) => s.trim()).filter(Boolean);
const joinName = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(" ");

function detect(keys: Set<string>): ContactCsvPreset | null {
  const hasValues = [...keys].some((k) => PHONE_VALUE.test(k) || EMAIL_VALUE.test(k));
  if (keys.has("first name") && keys.has("last name") && hasValues) return "google";
  if (keys.has("given name") && keys.has("family name") && hasValues) return "google-legacy";
  if (keys.has("first name") && keys.has("last name") && (keys.has("e-mail address") || keys.has("mobile phone"))) {
    return "outlook";
  }
  return null;
}

/** The columns a file has: by lowercase name, and the numbered phone/e-mail value columns in order. */
function columns(headers: string[]) {
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    const k = key(h);
    if (!index.has(k)) index.set(k, i);
  });
  const numbered = (re: RegExp) =>
    headers
      .map((h, i) => ({ n: Number(re.exec(key(h))?.[1] ?? NaN), i }))
      .filter((c) => !Number.isNaN(c.n))
      .sort((a, b) => a.n - b.n);
  return { index, phones: numbered(PHONE_VALUE), emails: numbered(EMAIL_VALUE) };
}

/** The file as "Importar CSV" reads it, and which address book it came from (null: left as it was). */
export function adaptContactCsv(table: CsvTable): { preset: ContactCsvPreset | null; table: CsvTable } {
  const { index, phones, emails } = columns(table.headers);
  const preset = detect(new Set(index.keys()));
  if (!preset) return { preset: null, table };

  const rows = table.rows.map((row) => {
    const get = (name: string) => {
      const i = index.get(name);
      return i === undefined ? "" : (row[i] ?? "").trim();
    };

    let name: string;
    let phone = "";
    let email = "";
    let company: string;
    let role: string;
    let tags: string;

    if (preset === "outlook") {
      name = joinName(get("first name"), get("middle name"), get("last name")) || get("nickname") || get("company");
      phone = OUTLOOK_PHONES.map(get).find(Boolean) ?? "";
      email = OUTLOOK_EMAILS.map(get).find(Boolean) ?? "";
      company = get("company");
      role = get("job title");
      tags = get("categories");
    } else {
      const legacy = preset === "google-legacy";
      name = legacy
        ? get("name") || joinName(get("given name"), get("additional name"), get("family name")) || get("nickname")
        : joinName(get("first name"), get("middle name"), get("last name")) || get("nickname") || get("file as");
      company = legacy ? get("organization 1 - name") : get("organization name");
      role = legacy ? get("organization 1 - title") : get("organization title");
      if (!name) name = company;
      // Every phone with its label ("Mobile", "Work"…; "Type" in the legacy file); a mobile one first.
      const candidates = phones.flatMap(({ n, i }) => {
        const label = get(`phone ${n} - ${legacy ? "type" : "label"}`);
        return split((row[i] ?? "").trim()).map((value) => ({ value, label }));
      });
      phone = (candidates.find((c) => MOBILE_LABEL.test(c.label)) ?? candidates[0])?.value ?? "";
      email = emails.flatMap(({ i }) => split((row[i] ?? "").trim()))[0] ?? "";
      tags = split(get(legacy ? "group membership" : "labels"))
        .filter((g) => !g.startsWith("*"))
        .join(", ");
    }
    return [name, phone, email, company, role, tags];
  });

  return { preset, table: { headers: OUT_HEADERS, rows } };
}
