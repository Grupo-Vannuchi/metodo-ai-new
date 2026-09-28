/**
 * Modelos de mensagem da Meta (puro). Usado pelo seletor de modelo da tela, pelo
 * formulário de campanha e pelo disparo. Variáveis `{{1}}` (POSITIONAL) ou
 * `{{first_name}}` (NAMED) no cabeçalho de texto e no corpo. Posicionais repetem
 * a numeração entre cabeçalho e corpo, então a identidade de uma variável é
 * "componente.chave" (ex.: "header.1", "body.1").
 * Fora do v1: cabeçalho de mídia/localização e botão com variável.
 */
export type TemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  buttons?: { type: string; text?: string; url?: string }[];
};

export type TemplateDef = {
  name: string;
  language: string;
  parameterFormat: string;
  components: TemplateComponent[];
};

export type TemplateVariable = { id: string; key: string; component: "header" | "body" };

export type ParamSource = { source: "nome" | "empresa" | "fixo"; value?: string };
export type ParamMapping = Record<string, ParamSource>;
export type ParamContext = { nome: string; empresa: string };

export type SendComponent = {
  type: "header" | "body";
  parameters: { type: "text"; text: string; parameter_name?: string }[];
};

export type UnsupportedReason = "media_header" | "location_header" | "button_variable";

export type CloudTemplateOption = {
  id: string;
  name: string;
  language: string;
  category: string;
  def: TemplateDef;
  variables: TemplateVariable[];
  unsupported: UnsupportedReason | null;
};

const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const FALLBACK = "-";
const BUTTONS_WITH_PARAMS = new Set(["COPY_CODE", "OTP", "FLOW", "CATALOG", "MPM"]);

function comp(def: TemplateDef, type: string): TemplateComponent | undefined {
  return def.components.find((c) => (c.type ?? "").toUpperCase() === type);
}

function keysIn(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function isNamed(def: TemplateDef): boolean {
  return (def.parameterFormat ?? "").toUpperCase() === "NAMED";
}

function headerIsText(h: TemplateComponent | undefined): boolean {
  return !!h && (h.format ?? "TEXT").toUpperCase() === "TEXT";
}

export function toTemplateDef(row: {
  name: string;
  language: string;
  parameterFormat: string;
  components: unknown;
}): TemplateDef {
  const components = Array.isArray(row.components)
    ? (row.components.filter((c) => c && typeof c === "object") as TemplateComponent[])
    : [];
  return { name: row.name, language: row.language, parameterFormat: row.parameterFormat, components };
}

export function templateVariables(def: TemplateDef): TemplateVariable[] {
  const named = isNamed(def);
  const order = (keys: string[]) => (named ? keys : [...keys].sort((a, b) => Number(a) - Number(b)));
  const header = comp(def, "HEADER");
  const headerKeys = headerIsText(header) ? order(keysIn(header?.text)) : [];
  const bodyKeys = order(keysIn(comp(def, "BODY")?.text));
  return [
    ...headerKeys.map((key) => ({ id: `header.${key}`, key, component: "header" as const })),
    ...bodyKeys.map((key) => ({ id: `body.${key}`, key, component: "body" as const })),
  ];
}

export function unsupportedReason(def: TemplateDef): UnsupportedReason | null {
  const header = comp(def, "HEADER");
  if (header && !headerIsText(header)) {
    return (header.format ?? "").toUpperCase() === "LOCATION" ? "location_header" : "media_header";
  }
  const buttons = comp(def, "BUTTONS")?.buttons ?? [];
  const hasVar = buttons.some((b) => keysIn(b.url).length > 0 || keysIn(b.text).length > 0);
  const needsParams = buttons.some((b) => BUTTONS_WITH_PARAMS.has((b.type ?? "").toUpperCase()));
  return hasVar || needsParams ? "button_variable" : null;
}

export function resolveParamValues(
  vars: TemplateVariable[],
  mapping: ParamMapping,
  ctx: ParamContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars) {
    const m = mapping[v.id];
    const reserve = (m?.value ?? "").trim();
    let value = "";
    if (m?.source === "nome") value = ctx.nome.trim() || reserve;
    else if (m?.source === "empresa") value = ctx.empresa.trim() || reserve;
    else if (m?.source === "fixo") value = reserve;
    out[v.id] = value || FALLBACK;
  }
  return out;
}

export function buildTemplateComponents(def: TemplateDef, values: Record<string, string>): SendComponent[] {
  const named = isNamed(def);
  const vars = templateVariables(def);
  const out: SendComponent[] = [];
  for (const component of ["header", "body"] as const) {
    const parameters = vars
      .filter((v) => v.component === component)
      .map((v) => ({
        type: "text" as const,
        text: values[v.id]?.trim() || FALLBACK,
        ...(named ? { parameter_name: v.key } : {}),
      }));
    if (parameters.length > 0) out.push({ type: component, parameters });
  }
  return out;
}

export function renderTemplateText(def: TemplateDef, values: Record<string, string>): string {
  const fill = (text: string | undefined, component: "header" | "body") =>
    (text ?? "").replace(VAR_RE, (_m, key: string) => values[`${component}.${key}`] ?? `{{${key}}}`);
  const header = comp(def, "HEADER");
  return [
    headerIsText(header) ? fill(header?.text, "header") : "",
    fill(comp(def, "BODY")?.text, "body"),
    comp(def, "FOOTER")?.text ?? "",
  ]
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}

const NAME_KEY = /nome|name|first/i;
const COMPANY_KEY = /empresa|company/i;

/** Valores iniciais para o vendedor editar no seletor de modelo. */
export function suggestValues(vars: TemplateVariable[], ctx: ParamContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars) {
    if (COMPANY_KEY.test(v.key)) out[v.id] = ctx.empresa;
    else if (NAME_KEY.test(v.key) || (v.component === "body" && v.key === "1")) out[v.id] = ctx.nome;
    else out[v.id] = "";
  }
  return out;
}

/** Mapeamento inicial no formulário de campanha. */
export function defaultMapping(vars: TemplateVariable[]): ParamMapping {
  const out: ParamMapping = {};
  for (const v of vars) {
    if (COMPANY_KEY.test(v.key)) out[v.id] = { source: "empresa", value: "" };
    else if (NAME_KEY.test(v.key) || (v.component === "body" && v.key === "1")) out[v.id] = { source: "nome", value: "cliente" };
    else out[v.id] = { source: "fixo", value: "" };
  }
  return out;
}

/** Toda variável tem origem, e texto fixo não pode ser vazio. */
export function mappingIsComplete(vars: TemplateVariable[], mapping: ParamMapping): boolean {
  return vars.every((v) => {
    const m = mapping[v.id];
    if (!m) return false;
    return m.source !== "fixo" || (m.value ?? "").trim().length > 0;
  });
}

export function toTemplateOption(row: {
  id: string;
  name: string;
  language: string;
  category: string;
  parameterFormat: string;
  components: unknown;
}): CloudTemplateOption {
  const def = toTemplateDef(row);
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    category: row.category,
    def,
    variables: templateVariables(def),
    unsupported: unsupportedReason(def),
  };
}
