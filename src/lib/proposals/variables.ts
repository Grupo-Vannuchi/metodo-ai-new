/**
 * Template variable engine. Text and rich-text in a proposal document may carry
 * `{{token}}` placeholders (e.g. `{{cliente}}`); they are resolved from the
 * proposal/client data at RENDER time (export), so late-bound values like the
 * final total and validity are always current. Unknown tokens are left intact
 * so typos stay visible instead of silently vanishing.
 */

export type ProposalVarSource = {
  clientName?: string | null;
  clientCompany?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  clientAddress?: string | null;
  city?: string | null;
  title?: string | null;
  code?: string | null;
  subtotal?: number;
  discount?: number;
  total?: number;
  validUntil?: Date | null;
  date?: Date | null;
  ownerName?: string | null;
  orgName?: string | null;
};

/** Supported variables, for the editor hint / insert menu (label + token). */
export const PROPOSAL_VARIABLES: { token: string; label: string }[] = [
  { token: "cliente", label: "Cliente" },
  { token: "empresa", label: "Empresa" },
  { token: "email", label: "E-mail" },
  { token: "telefone", label: "Telefone" },
  { token: "endereco", label: "Endereço" },
  { token: "cidade", label: "Cidade" },
  { token: "titulo", label: "Título" },
  { token: "codigo", label: "Código" },
  { token: "valor", label: "Valor total" },
  { token: "subtotal", label: "Subtotal" },
  { token: "desconto", label: "Desconto" },
  { token: "validade", label: "Validade" },
  { token: "data", label: "Data" },
  { token: "vendedor", label: "Vendedor" },
  { token: "organizacao", label: "Organização" },
];

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (n?: number) => BRL.format(Number(n) || 0);
const dt = (d?: Date | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "");

/** Build the `{token: value}` map for a proposal. Values are plain text. */
export function buildProposalVars(s: ProposalVarSource): Record<string, string> {
  return {
    cliente: s.clientName ?? "",
    empresa: s.clientCompany ?? "",
    email: s.clientEmail ?? "",
    telefone: s.clientPhone ?? "",
    endereco: s.clientAddress ?? "",
    cidade: s.city ?? "",
    titulo: s.title ?? "",
    codigo: s.code ?? "",
    valor: brl(s.total),
    subtotal: brl(s.subtotal),
    desconto: brl(s.discount),
    validade: dt(s.validUntil),
    data: dt(s.date ?? new Date()),
    vendedor: s.ownerName ?? "",
    organizacao: s.orgName ?? "",
  };
}

/**
 * Replace `{{token}}` occurrences (case-insensitive, tolerant of inner spaces)
 * with the mapped value. Unknown tokens are returned unchanged. `transform` lets
 * the caller escape values for an HTML context.
 */
export function substituteVars(
  text: string,
  vars: Record<string, string>,
  transform: (value: string) => string = (v) => v,
): string {
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, key: string) => {
    const value = vars[key.toLowerCase()];
    return value === undefined ? match : transform(value);
  });
}
