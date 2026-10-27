/**
 * Self-check for the pure rules of the WhatsApp automation (no DB, no network,
 * no env): rule parsing and validation, the menu text and how a reply picks an
 * option. Run with `npm run check:automation`; exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { parseActions, parseConfig, ruleProblem, type RuleAction, type RuleConfig } from "../src/lib/automation/types";
import { formatMenu, invalidMenuReply, parseMenuChoice } from "../src/lib/automation/menu";

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

console.log(`\n✅ automation: ${passed} checks passed.`);
