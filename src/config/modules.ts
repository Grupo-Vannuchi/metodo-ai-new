/** Capabilities a module unlocks — the gating flags used across the app. */
export type Feature =
  | "campaigns.whatsapp"
  | "campaigns.email"
  | "campaigns.scheduling.advanced"
  | "prospecting"
  | "finance"
  | "hr"
  | "supplies"
  | "assistant"
  | "whatsapp_agent"
  | "webhooks.outbound"
  | "sso";

/**
 * The MetodoLoja module registry — the single source of truth for the modular
 * platform. The core ("Método cru") ships with no business functions; an org
 * installs MODULES from the store, each adding to its monthly price. This
 * replaces plan-based feature bundles: gating shifts from `hasFeature(plan, …)`
 * to `hasModule(installedModules, …)`.
 *
 * NOT server-only: the store UI and marketing pages read this on the client too.
 */

export type ModuleId =
  | "crm"
  | "finance"
  | "hr"
  | "supplies"
  | "marketing"
  | "inbox"
  | "ia"
  | "tasks";

export type ModuleCategory = "comercial" | "operacao" | "atendimento" | "ia" | "produtividade";

export type ModuleDef = {
  id: ModuleId;
  /** Display name in the store / nav group. */
  name: string;
  /** One-line pitch for the store card. */
  tagline: string;
  /** Lucide icon name (resolved to a component in the UI). */
  icon: string;
  /** Simulated monthly price in BRL (no real billing yet — see the plan). */
  priceMonthly: number;
  category: ModuleCategory;
  /** Hard dependencies — cannot be installed/used without these (enforced by the store). */
  dependsOn: ModuleId[];
  /** Soft integrations — works better with these, but not required (display only). */
  integratesWith: ModuleId[];
  /** Features (from plans.ts) this module unlocks. */
  unlocks: Feature[];
  /** Gateable screen keys this module owns (see config/screens.ts). */
  screens: string[];
};

/**
 * The modules, "grosso" (one per area). Screens/features that used to be gated
 * by plan now belong to a module; the CRM funnel, proposals, etc. (previously
 * ungated) become the `crm` module. Contacts & Companies stay in the CORE (the
 * shared address book every module references) — see CORE_SCREENS.
 */
export const MODULES: ModuleDef[] = [
  {
    id: "crm",
    name: "CRM Comercial",
    tagline: "Funil de vendas, oportunidades, propostas, metas e automações.",
    icon: "Target",
    priceMonthly: 79,
    category: "comercial",
    dependsOn: [],
    integratesWith: ["marketing", "inbox", "finance"],
    unlocks: [],
    screens: ["crm", "proposals"],
  },
  {
    id: "finance",
    name: "Financeiro",
    tagline: "Lançamentos, fluxo de caixa e DRE.",
    icon: "Wallet",
    priceMonthly: 89,
    category: "operacao",
    dependsOn: [],
    integratesWith: ["crm", "supplies", "hr"],
    unlocks: ["finance"],
    screens: ["finance"],
  },
  {
    id: "hr",
    name: "Pessoas (RH)",
    tagline: "Funcionários, folha de pagamento, férias e documentos.",
    icon: "Users",
    priceMonthly: 69,
    category: "operacao",
    dependsOn: [],
    integratesWith: ["finance"],
    unlocks: ["hr"],
    screens: ["hr"],
  },
  {
    id: "supplies",
    name: "Suprimentos",
    tagline: "Estoque, compras, patrimônio, manutenção e equipamentos de clientes.",
    icon: "Package",
    priceMonthly: 89,
    category: "operacao",
    dependsOn: [],
    integratesWith: ["finance"],
    unlocks: ["supplies"],
    screens: ["supplies"],
  },
  {
    id: "marketing",
    name: "Marketing",
    tagline: "Campanhas de WhatsApp e e-mail, agendamento e prospecção de leads.",
    icon: "Megaphone",
    priceMonthly: 79,
    category: "comercial",
    dependsOn: [],
    integratesWith: ["crm", "inbox"],
    unlocks: ["campaigns.whatsapp", "campaigns.email", "campaigns.scheduling.advanced", "prospecting"],
    screens: ["campaigns", "prospecting"],
  },
  {
    id: "inbox",
    name: "Atendimento WhatsApp",
    tagline: "Caixa de entrada multi-conversa e conexões de números.",
    icon: "MessageCircle",
    priceMonthly: 59,
    category: "atendimento",
    dependsOn: [],
    integratesWith: ["crm", "ia"],
    unlocks: [],
    screens: ["inbox", "connections"],
  },
  {
    id: "ia",
    name: "Inteligência Artificial",
    tagline: "Copiloto no sistema + agente que atende clientes no WhatsApp.",
    icon: "Sparkles",
    priceMonthly: 99,
    category: "ia",
    dependsOn: [],
    integratesWith: ["inbox", "crm"],
    unlocks: ["assistant", "whatsapp_agent"],
    screens: [],
  },
  {
    id: "tasks",
    name: "Tarefas",
    tagline: "Listas e tarefas da equipe.",
    icon: "CheckSquare",
    priceMonthly: 0,
    category: "produtividade",
    dependsOn: [],
    integratesWith: ["crm"],
    unlocks: [],
    screens: ["tasks"],
  },
];

/** Screens that belong to the CORE (always available, subject to AccessTemplate):
 *  no module owns them. Contacts/Companies are the shared base every module uses. */
export const CORE_SCREENS = ["dashboard", "settings", "contacts", "companies", "feed"] as const;

export const MODULE_BY_ID: Record<ModuleId, ModuleDef> = Object.fromEntries(
  MODULES.map((m) => [m.id, m]),
) as Record<ModuleId, ModuleDef>;

export const ALL_MODULE_IDS: ModuleId[] = MODULES.map((m) => m.id);

/** feature → the module that unlocks it (built from MODULES[].unlocks). */
export const FEATURE_MODULE: Partial<Record<Feature, ModuleId>> = Object.fromEntries(
  MODULES.flatMap((m) => m.unlocks.map((f) => [f, m.id])),
) as Partial<Record<Feature, ModuleId>>;

/** True when the given module id is installed (active) for the org. */
export function hasModule(installed: readonly string[], id: ModuleId): boolean {
  return installed.includes(id);
}

/** True when a feature is unlocked by any installed module (the `hasFeature`
 *  replacement for the modular model). Features with no owning module are off. */
export function hasFeatureByModules(installed: readonly string[], feature: Feature): boolean {
  const owner = FEATURE_MODULE[feature];
  return owner ? installed.includes(owner) : false;
}

/** Throws when the feature's owning module isn't installed. The module-model
 *  replacement for `assertFeature` — use at the top of gated actions/jobs. */
export function assertFeatureByModules(installed: readonly string[], feature: Feature): void {
  if (!hasFeatureByModules(installed, feature)) {
    throw new Error(`Módulo necessário para "${feature}" não está instalado`);
  }
}

/** Screens available given the installed modules: the CORE plus every installed
 *  module's screens. Nav should intersect this with the member's AccessTemplate. */
export function availableScreens(installed: readonly string[]): Set<string> {
  const set = new Set<string>(CORE_SCREENS);
  for (const m of MODULES) if (installed.includes(m.id)) for (const s of m.screens) set.add(s);
  return set;
}

/** The screen key → owning module id (for nav gating in Fase 1). */
export const SCREEN_MODULE: Record<string, ModuleId> = Object.fromEntries(
  MODULES.flatMap((m) => m.screens.map((s) => [s, m.id])),
);

/** Store "packages" — the old plans reborn as presets that pre-select modules. */
export type ModulePreset = { id: string; name: string; tagline: string; modules: ModuleId[] };

export const MODULE_PRESETS: ModulePreset[] = [
  {
    id: "comercial",
    name: "Comercial",
    tagline: "Vender e atender: funil, campanhas e WhatsApp.",
    modules: ["crm", "marketing", "inbox", "tasks"],
  },
  {
    id: "operacao",
    name: "Operação",
    tagline: "Rodar a empresa: financeiro, suprimentos e pessoas.",
    modules: ["finance", "supplies", "hr", "tasks"],
  },
  {
    id: "completo",
    name: "Completo",
    tagline: "Tudo do Método, com IA.",
    modules: [...ALL_MODULE_IDS],
  },
];

/** Sum the monthly price of a set of installed modules (simulated billing). */
export function monthlyTotal(installed: readonly string[]): number {
  return MODULES.filter((m) => installed.includes(m.id)).reduce((sum, m) => sum + m.priceMonthly, 0);
}
