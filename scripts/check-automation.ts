/**
 * Self-check for the pure rules of the WhatsApp automation (no DB, no network,
 * no env): rule parsing and validation, the menu text and how a reply picks an
 * option. Run with `npm run check:automation`; exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { parseActions, parseConfig, ruleProblem, type RuleAction, type RuleConfig } from "../src/lib/automation/types";
import { formatMenu, invalidMenuReply, parseMenuChoice } from "../src/lib/automation/menu";
import {
  activePath,
  canStartOnAnyMessage,
  opportunityNotes,
  opportunityTitle,
  pickMenuChoice,
  sessionFitsRule,
  type AnyStartFacts,
} from "../src/lib/automation/flow-core";
import type { FlowStep } from "../src/lib/automation/types";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const menu = (over: Partial<Extract<RuleAction, { type: "ask_menu" }>> = {}): RuleAction => ({
  type: "ask_menu",
  question: "Sobre qual evento você deseja falar?",
  options: [
    { label: "Evento X", questions: [{ label: "Qual o seu nome?", field: "name" }] },
    { label: "Evento Y", questions: [] },
  ],
  ...over,
});
const waRule = (actions: RuleAction[], wa: Partial<NonNullable<RuleConfig["whatsapp"]>> = {}) => ({
  name: "Eventos",
  trigger: "whatsapp_message" as const,
  actions,
  config: { whatsapp: { connectionId: "c1", start: "keyword" as const, keyword: "evento", match: "contains" as const, ...wa } },
});

// ── parseConfig ─────────────────────────────────────────────────────────────

check("parseConfig: a rule saved before `start` existed starts with its keyword", () => {
  const cfg = parseConfig({ whatsapp: { connectionId: "c", keyword: "evento", match: "contains" } });
  assert.deepEqual(cfg.whatsapp, { connectionId: "c", start: "keyword", keyword: "evento", match: "contains" });
});

check("parseConfig: start is 'any' only when saved as 'any'", () => {
  assert.equal(parseConfig({ whatsapp: { connectionId: "c", start: "any", keyword: "" } }).whatsapp?.start, "any");
  assert.equal(parseConfig({ whatsapp: { connectionId: "c", start: "lixo", keyword: "x" } }).whatsapp?.start, "keyword");
});

check("parseConfig: reads the option nodes' positions in layout.branches", () => {
  const cfg = parseConfig({ layout: { branches: [{ x: 10, y: 20 }, { x: "a" }, { x: 30, y: 40 }] } });
  assert.deepEqual(cfg.layout?.branches, [{ x: 10, y: 20 }, { x: 30, y: 40 }]);
});

// ── parseActions ────────────────────────────────────────────────────────────

check("parseActions: ask_menu cuts the option name to 60 (trimmed) and the menu question to 300", () => {
  const [a] = parseActions([
    { type: "ask_menu", question: "q".repeat(400), options: [{ label: `  ${"x".repeat(80)}  `, questions: [] }] },
  ]);
  assert.equal(a.type, "ask_menu");
  if (a.type !== "ask_menu") return;
  assert.equal(a.question.length, 300);
  assert.equal(a.options[0].label, "x".repeat(60));
});

check("parseActions: ask_menu keeps at most 9 options and 15 questions per option", () => {
  const q = Array.from({ length: 16 }, (_, i) => ({ label: `P${i}`, field: "notes" }));
  const options = Array.from({ length: 10 }, (_, i) => ({ label: `O${i}`, questions: q }));
  const [a] = parseActions([{ type: "ask_menu", question: "Q", options }]);
  if (a.type !== "ask_menu") return assert.fail("not ask_menu");
  assert.equal(a.options.length, 9);
  assert.equal(a.options[0].questions.length, 15);
});

check("parseActions: ask_menu option with an unknown field saves to notes; empty final message is dropped", () => {
  const [a] = parseActions([
    { type: "ask_menu", question: "Q", firstMessage: "", options: [{ label: "A", questions: [{ label: "P", field: "phone" }], finalMessage: "" }] },
  ]);
  if (a.type !== "ask_menu") return assert.fail("not ask_menu");
  assert.equal(a.options[0].questions[0].field, "notes");
  assert.equal(a.options[0].finalMessage, undefined);
  assert.equal(a.firstMessage, undefined);
});

check("parseActions: ask_questions and the legacy ai_collect parse as before", () => {
  const raw = { questions: [{ label: "Nome?", field: "name" }, { label: "Obs", field: "x" }], firstMessage: "Oi", finalMessage: "Fim" };
  const expected = [{
    type: "ask_questions",
    questions: [{ label: "Nome?", field: "name" }, { label: "Obs", field: "notes" }],
    firstMessage: "Oi",
    finalMessage: "Fim",
  }];
  assert.deepEqual(parseActions([{ type: "ask_questions", ...raw }]), expected);
  assert.deepEqual(parseActions([{ type: "ai_collect", ...raw }]), expected);
});

// ── ruleProblem ─────────────────────────────────────────────────────────────

check("ruleProblem: 'any message' needs no keyword; 'keyword' still does", () => {
  assert.equal(ruleProblem(waRule([menu()], { start: "any", keyword: "" })), null);
  assert.equal(ruleProblem(waRule([menu()], { start: "keyword", keyword: "" })), "keyword");
});

check("ruleProblem: the menu needs its question and 2+ named options", () => {
  assert.equal(ruleProblem(waRule([menu({ question: "  " })])), "menuQuestion");
  assert.equal(ruleProblem(waRule([menu({ options: [{ label: "A", questions: [] }] })])), "menuOptions");
  assert.equal(ruleProblem(waRule([menu({ options: [{ label: "A", questions: [] }, { label: " ", questions: [] }] })])), "menuOptions");
});

check("ruleProblem: an empty question inside an option is 'questions'; an option without questions is fine", () => {
  const blank = menu({ options: [{ label: "A", questions: [{ label: " ", field: "notes" }] }, { label: "B", questions: [] }] });
  assert.equal(ruleProblem(waRule([blank])), "questions");
  assert.equal(ruleProblem(waRule([menu(), { type: "create_opportunity" }])), null);
});

check("ruleProblem: the menu must be the only flow step, and first", () => {
  assert.equal(ruleProblem(waRule([{ type: "create_opportunity" }, menu()])), "questionsFirst");
  assert.equal(ruleProblem(waRule([menu(), { type: "ask_questions", questions: [{ label: "P", field: "notes" }] }])), "questionsFirst");
});

check("ruleProblem: the menu outside the WhatsApp trigger is 'whatsappOnly'", () => {
  assert.equal(ruleProblem({ name: "x", trigger: "stage_entered", triggerStageId: "s", actions: [menu()], config: {} }), "whatsappOnly");
});

// ── Menu text ───────────────────────────────────────────────────────────────

check("formatMenu: question, blank line, then 'N - option'", () => {
  assert.equal(
    formatMenu("Sobre qual evento você deseja falar?", ["Evento X", "Evento Y"]),
    "Sobre qual evento você deseja falar?\n\n1 - Evento X\n2 - Evento Y",
  );
});

check("invalidMenuReply: the fixed warning, blank line, then the options", () => {
  assert.equal(invalidMenuReply(["A", "B"]), "Não entendi. Responda com o número de uma das opções:\n\n1 - A\n2 - B");
});

check("parseMenuChoice: number variants and the option's name pick it", () => {
  const L = ["Evento X", "Evento Y", "Evento Z"];
  for (const t of ["2", "2.", "2)", "2 -", " opção 2 ", "Opcao 2", "op 2", "numero 2", "2️⃣", "evento y", "EVENTO Y", "2 evento y"]) {
    assert.equal(parseMenuChoice(t, L), 1, `"${t}" should pick option 2`);
  }
});

check("parseMenuChoice: anything else is no choice", () => {
  const L = ["Evento X", "Evento Y", "Evento Z"];
  for (const t of ["4", "0", "10", "1 e 2", "oi", "o de sábado", ""]) {
    assert.equal(parseMenuChoice(t, L), null, `"${t}" should not pick an option`);
  }
});

// ── Flow: active path, session fit, menu choice ────────────────────────────

const ask: FlowStep = {
  type: "ask_questions",
  questions: [{ label: "Nome?", field: "name" }, { label: "Data?", field: "notes" }],
  finalMessage: "Fim",
};
const menuStep: FlowStep = {
  type: "ask_menu",
  question: "Qual evento?",
  options: [
    { label: "Evento X", questions: [{ label: "Ingressos?", field: "notes" }], finalMessage: "FX" },
    { label: "Evento Y", questions: [{ label: "Empresa?", field: "notes" }, { label: "Pessoas?", field: "notes" }], finalMessage: "FY" },
    { label: "Atendente", questions: [] },
  ],
};

check("activePath: fixed questions are the step's own", () => {
  assert.deepEqual(activePath(ask, {}), { questions: ask.questions, finalMessage: "Fim" });
});

check("activePath: a menu waits for the choice, then follows the chosen option", () => {
  assert.equal(activePath(menuStep, {}), null);
  assert.deepEqual(activePath(menuStep, { menu: "1", menuLabel: "Evento Y" }), {
    questions: menuStep.type === "ask_menu" ? menuStep.options[1].questions : [],
    finalMessage: "FY",
    choice: { index: 1, label: "Evento Y" },
  });
  assert.equal(activePath(menuStep, { menu: "7" }), null);
  assert.equal(activePath(menuStep, { menu: "x" }), null);
});

check("sessionFitsRule: sessions that can go on", () => {
  assert.equal(sessionFitsRule(ask, {}), true);
  assert.equal(sessionFitsRule(ask, { "0": "Ana" }), true);
  assert.equal(sessionFitsRule(menuStep, {}), true);
  assert.equal(sessionFitsRule(menuStep, { menu: "1", menuLabel: "Evento Y", "0": "ACME" }), true);
});

check("sessionFitsRule: sessions the rule no longer fits", () => {
  assert.equal(sessionFitsRule(ask, { menu: "0", menuLabel: "Evento X" }), false, "questions rule with a menu answer");
  assert.equal(sessionFitsRule(ask, { "0": "Ana", "1": "sexta" }), false, "all questions answered");
  assert.equal(sessionFitsRule(menuStep, { "0": "Ana" }), false, "rule switched from questions to a menu");
  assert.equal(sessionFitsRule(menuStep, { menu: "1", menuLabel: "Evento X" }), false, "options reordered or renamed");
  assert.equal(sessionFitsRule(menuStep, { menu: "5", menuLabel: "Evento Y" }), false, "index out of range");
  assert.equal(sessionFitsRule(menuStep, { menu: "1", menuLabel: "Evento Y", "0": "ACME", "1": "12" }), false, "path done");
});

check("pickMenuChoice: the last line that picks an option wins", () => {
  const L = ["Evento X", "Evento Y", "Evento Z"];
  assert.equal(pickMenuChoice(["2", "obrigado"], L), 1);
  assert.equal(pickMenuChoice(["oi", "3"], L), 2);
  assert.equal(pickMenuChoice(["oi", "tudo bem"], L), null);
});

// ── Flow: when "any message" starts ─────────────────────────────────────────

const ARRIVED = new Date("2026-10-27T12:00:00Z");
const ago = (ms: number) => new Date(ARRIVED.getTime() - ms);
const H = 60 * 60 * 1000;
const D = 24 * H;
const facts = (over: Partial<AnyStartFacts> = {}): AnyStartFacts => ({
  arrivedAt: ARRIVED,
  assigned: false,
  lastActivityAt: null,
  lastSession: null,
  humanReplyAfterLastSession: false,
  ...over,
});

check("canStartOnAnyMessage: a new conversation starts", () => {
  assert.equal(canStartOnAnyMessage(facts()), true);
});

check("canStartOnAnyMessage: it takes 7 full days of quiet", () => {
  assert.equal(canStartOnAnyMessage(facts({ lastActivityAt: ago(7 * D - H) })), false);
  assert.equal(canStartOnAnyMessage(facts({ lastActivityAt: ago(7 * D) })), true);
});

check("canStartOnAnyMessage: an assigned conversation never starts", () => {
  assert.equal(canStartOnAnyMessage(facts({ assigned: true })), false);
  assert.equal(canStartOnAnyMessage(facts({ assigned: true, lastActivityAt: ago(30 * D) })), false);
});

check("canStartOnAnyMessage: a lead who abandoned the flow restarts unless a person replied since", () => {
  for (const status of ["EXPIRED", "CANCELED"] as const) {
    const lastSession = { status, createdAt: ago(26 * H) };
    assert.equal(canStartOnAnyMessage(facts({ lastActivityAt: ago(H), lastSession })), true, status);
    assert.equal(canStartOnAnyMessage(facts({ lastActivityAt: ago(H), lastSession, humanReplyAfterLastSession: true })), false, status);
  }
});

check("canStartOnAnyMessage: a finished flow doesn't restart on the next message", () => {
  for (const status of ["COMPLETED", "HANDOFF"] as const) {
    assert.equal(canStartOnAnyMessage(facts({ lastActivityAt: ago(H), lastSession: { status, createdAt: ago(2 * H) } })), false, status);
  }
});

// ── Flow: what the opportunity gets ─────────────────────────────────────────

check("opportunityNotes: fixed questions read exactly as before", () => {
  const path = activePath(ask, {})!;
  assert.equal(
    opportunityNotes("Eventos", path, { "0": "Ana" }),
    'Nome?: Ana\nData?: —\nOrigem: WhatsApp (automação "Eventos")',
  );
});

check("opportunityNotes: a menu path opens with the chosen option", () => {
  const answers = { menu: "1", menuLabel: "Evento Y", "0": "ACME", "1": "12" };
  assert.equal(
    opportunityNotes("Eventos", activePath(menuStep, answers)!, answers),
    'Opção escolhida: Evento Y\nEmpresa?: ACME\nPessoas?: 12\nOrigem: WhatsApp (automação "Eventos")',
  );
});

check("opportunityTitle: rule · option · contact, or rule · contact as before", () => {
  const plain = activePath(ask, {})!;
  assert.equal(opportunityTitle("Eventos", plain, "Ana"), "Eventos · Ana");
  assert.equal(opportunityTitle("Eventos", plain, null), "Eventos · ");
  const chosen = activePath(menuStep, { menu: "1", menuLabel: "Evento Y" })!;
  assert.equal(opportunityTitle("Eventos", chosen, "Ana"), "Eventos · Evento Y · Ana");
});

console.log(`\n✅ automation: ${passed} checks passed.`);
