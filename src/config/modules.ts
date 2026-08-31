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
  | "tasks"
  | "downloader";

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
    screens: ["crm", "proposals", "contacts", "companies"],
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
    screens: ["inbox"],
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
  {
    id: "downloader",
    name: "Baixador",
    tagline: "Baixe vídeos do Instagram, X (Twitter) e YouTube por link.",
    icon: "Download",
    priceMonthly: 39,
    category: "produtividade",
    dependsOn: [],
    integratesWith: [],
    unlocks: [],
    screens: ["downloader"],
  },
];

/** Screens that belong to the CORE (always available, subject to AccessTemplate):
 *  no module owns them. Contacts/Companies are the shared base every module uses. */
export const CORE_SCREENS = ["dashboard", "settings", "feed"] as const;

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

/** One element that composes a module — shown in the store's detail modal. */
export type ModuleFeatureItem = { title: string; desc: string };

/** Rich content for the "clique no módulo → detalhes" store modal: what the
 *  module is, who it's for (niche) and the items that compose it. Kept in pt to
 *  match the hardcoded name/tagline above. */
export type ModuleDetail = {
  /** A paragraph explaining the module and the problem it solves. */
  overview: string;
  /** The niche / who it's for. */
  niche: string;
  /** The elements that compose the module. */
  features: ModuleFeatureItem[];
};

export const MODULE_DETAILS: Record<ModuleId, ModuleDetail> = {
  crm: {
    overview:
      "O centro comercial do Método. Organiza todo o processo de venda em um funil visual: cada oportunidade avança por etapas até o ganho, gerando propostas, metas e um histórico completo do relacionamento com o cliente. Ao fechar, a venda pode virar um lançamento no Financeiro em um clique.",
    niche:
      "Times de vendas e consultores B2B que trabalham com pipeline — quem precisa acompanhar oportunidades, prazos e taxa de conversão de perto.",
    features: [
      { title: "Funil de vendas", desc: "Kanban de etapas personalizáveis, arraste as oportunidades entre as fases." },
      { title: "Oportunidades", desc: "Código sequencial (NNNN/AA), valor, responsável e desfecho (ganho, perda ou cancelamento com motivo)." },
      { title: "Propostas", desc: "Editor rico com catálogo de produtos e serviços; envie e acompanhe a aceitação." },
      { title: "Contatos e Empresas", desc: "Agenda compartilhada que serve de base para todos os outros módulos." },
      { title: "Metas", desc: "Defina alvos por período e acompanhe o realizado da equipe." },
      { title: "Automações", desc: "Regras por etapa do funil para criar tarefas e disparar ações automaticamente." },
    ],
  },
  finance: {
    overview:
      "A saúde financeira da empresa em um só lugar. Registre receitas e despesas como lançamentos (a fonte única da verdade), acompanhe o caixa no tempo e enxergue o resultado pelo DRE. Integra com CRM, Suprimentos e RH para que vendas, compras e folha virem lançamentos sem retrabalho.",
    niche:
      "Donos e financeiro de PMEs que querem controlar caixa e resultado sem planilhas soltas.",
    features: [
      { title: "Lançamentos", desc: "Receitas e despesas com vencimento, baixa e parcelamento — a fonte única do módulo." },
      { title: "Fluxo de caixa", desc: "Entradas e saídas ao longo do tempo, previsto x realizado." },
      { title: "DRE", desc: "Demonstrativo de resultado consolidado por período." },
      { title: "Categorias e métodos", desc: "Classifique cada lançamento por categoria e forma de pagamento." },
      { title: "Vínculo com o CRM", desc: "Amarre lançamentos a contato, empresa ou oportunidade (requer o módulo CRM)." },
    ],
  },
  hr: {
    overview:
      "Gestão de pessoas do cadastro ao pagamento. Centraliza a ficha de cada funcionário, monta a folha com proventos e descontos e controla férias e documentos. Ao pagar a folha, o valor pode ser lançado direto no Financeiro.",
    niche:
      "Empresas com equipe própria que precisam organizar folha, férias e documentação sem depender só do contador.",
    features: [
      { title: "Funcionários", desc: "Cadastro completo, cargos, admissão e dados trabalhistas." },
      { title: "Folha de pagamento", desc: "Proventos e descontos, aprovação e pagamento com baixa no Financeiro." },
      { title: "Férias", desc: "Controle de períodos aquisitivos e agendamento." },
      { title: "Documentos", desc: "Repositório dos documentos de cada colaborador." },
    ],
  },
  supplies: {
    overview:
      "O ERP de bastidores do Método. Controla estoque, compras, patrimônio e manutenção — e ainda os equipamentos que ficam na casa dos clientes. As compras podem gerar lançamentos no Financeiro e o estoque suporta reservas para não vender o que não tem.",
    niche:
      "Operações que lidam com produtos físicos, ativos ou assistência técnica — comércio, indústria leve e prestadores com equipamentos.",
    features: [
      { title: "Estoque", desc: "Itens, saldos e reservas para evitar rupturas." },
      { title: "Compras", desc: "Pedidos de compra com recebimento e lançamento no Financeiro." },
      { title: "Patrimônio", desc: "Bens e ativos da empresa com histórico." },
      { title: "Manutenção", desc: "Ordens e acompanhamento de manutenções." },
      { title: "Equipamentos de clientes", desc: "Rastreie máquinas e itens instalados na base de clientes." },
      { title: "Indicadores", desc: "Painéis de giro, custo e desempenho de suprimentos." },
    ],
  },
  marketing: {
    overview:
      "Alcance e captação em um módulo só. Dispare campanhas de WhatsApp e e-mail para públicos segmentados, agende envios e prospecte novos leads a partir do Google Places com enriquecimento de dados. Combinado com o CRM, segmenta por etapa do funil.",
    niche:
      "Times de marketing e crescimento que fazem disparos em massa e prospecção ativa de clientes.",
    features: [
      { title: "Campanhas de WhatsApp", desc: "Disparos em massa por template para listas segmentadas." },
      { title: "Campanhas de e-mail", desc: "E-mail marketing com o mesmo motor de segmentação." },
      { title: "Agendamento avançado", desc: "Programe envios para a melhor data e hora." },
      { title: "Segmentação de público", desc: "Filtre por tags, origem, dono e — com o CRM — etapa/status do funil." },
      { title: "Prospecção de leads", desc: "Busca no Google Places com enriquecimento do site (chave própria, LGPD-friendly)." },
    ],
  },
  inbox: {
    overview:
      "Todas as conversas de WhatsApp da empresa em uma caixa de entrada compartilhada. Conecte um ou mais números, atenda vários clientes ao mesmo tempo e mantenha o histórico ligado ao CRM. É a base sobre a qual o agente de IA responde os clientes.",
    niche:
      "Atendimento, suporte e comercial que conversam com clientes pelo WhatsApp e precisam de organização e histórico.",
    features: [
      { title: "Caixa de entrada", desc: "Multi-conversa com fila, status e busca." },
      { title: "Conexão de números", desc: "Conecte números via Evolution direto na tela de Conversas." },
      { title: "Atribuição e CRM", desc: "Auto-vínculo do contato e atribuição de conversas para a equipe." },
      { title: "Mídia e áudio", desc: "Envie e receba imagens, arquivos e mensagens de voz." },
    ],
  },
  ia: {
    overview:
      "A camada de inteligência do Método. Traz um copiloto que age dentro do sistema (consulta e executa ações por comando) e um agente que atende seus clientes no WhatsApp de forma autônoma, com transcrição de áudio e repasse para um humano quando necessário.",
    niche:
      "Empresas que querem ganhar escala no atendimento e na operação com automação inteligente, sem contratar mais gente.",
    features: [
      { title: "Copiloto no sistema", desc: "Assistente que lê e executa ações do CRM por function-calling." },
      { title: "Agente no WhatsApp", desc: "Responde clientes automaticamente usando as ferramentas do CRM." },
      { title: "Transcrição de áudio", desc: "Entende mensagens de voz recebidas dos clientes." },
      { title: "Handoff para humano", desc: "Passa a conversa para um atendente quando a IA identifica o limite." },
    ],
  },
  tasks: {
    overview:
      "O quadro de tarefas da equipe. Crie listas, atribua responsáveis e acompanhe prazos e status. Quando há CRM instalado, uma tarefa pode ser amarrada a um contato ou oportunidade — mas funciona sozinho como um to-do compartilhado.",
    niche:
      "Qualquer equipe que precise organizar o dia a dia e não perder pendências — do time comercial ao operacional.",
    features: [
      { title: "Listas e tarefas", desc: "Organize o trabalho em listas com itens acionáveis." },
      { title: "Atribuição", desc: "Defina o responsável de cada tarefa dentro da equipe." },
      { title: "Prazos e status", desc: "Datas de entrega e acompanhamento do andamento." },
      { title: "Vínculo com o CRM", desc: "Ligue tarefas a contatos e oportunidades quando o CRM está instalado." },
    ],
  },
  downloader: {
    overview:
      "Baixe vídeos das redes sociais direto pelo link. Cole a URL de um Reel/post do Instagram, de um vídeo do X (Twitter) ou do YouTube e o Baixador resolve o arquivo para você salvar — como os downloaders da internet, só que dentro do Método.",
    niche:
      "Marketing e social media que precisam guardar vídeos de referência, reaproveitar conteúdo próprio ou montar acervo — sem depender de site aleatório cheio de anúncio.",
    features: [
      { title: "Instagram", desc: "Reels e vídeos de posts públicos a partir do link." },
      { title: "X (Twitter)", desc: "Vídeos de tweets públicos, escolhendo a qualidade." },
      { title: "YouTube", desc: "Vídeos do YouTube em MP4 (com áudio)." },
      { title: "Escolha de qualidade", desc: "Quando disponível, mostra as resoluções para você baixar a que quiser." },
      { title: "Download direto", desc: "O arquivo baixa pelo próprio Método, sem redirecionar para sites externos." },
    ],
  },
};
