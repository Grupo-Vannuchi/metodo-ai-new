/**
 * Self-check for the type-ahead filter behind SearchSelect (no DB, no network,
 * no env). Run with `npm run check:search`; exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { normalizeSearch, searchOptions, SEARCH_LIMIT } from "../src/lib/search-options";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const opt = (id: string, name: string) => ({ id, name });
const names = (r: { matches: { name: string }[] }) => r.matches.map((m) => m.name);

check("normalizeSearch drops accents and case and folds spaces", () => {
  assert.equal(normalizeSearch("  João   da  SILVA "), "joao da silva");
  assert.equal(normalizeSearch("Ação & Cia"), "acao & cia");
  assert.equal(normalizeSearch(""), "");
});

check("an empty or blank query shows nothing", () => {
  const options = [opt("1", "Ana"), opt("2", "Bruno")];
  assert.deepEqual(searchOptions(options, ""), { matches: [], more: false });
  assert.deepEqual(searchOptions(options, "   "), { matches: [], more: false });
});

check("matches anywhere in the name, ignoring case and accents", () => {
  const options = [opt("1", "João Pereira"), opt("2", "Maria"), opt("3", "Ana Joana")];
  assert.deepEqual(names(searchOptions(options, "joao")), ["João Pereira"]);
  assert.deepEqual(names(searchOptions(options, "JOÃO")), ["João Pereira"]);
  assert.deepEqual(names(searchOptions(options, "per")), ["João Pereira"]);
  assert.deepEqual(names(searchOptions(options, "xyz")), []);
});

check("names that start with the query come first, otherwise input order is kept", () => {
  const options = [opt("1", "Ana Paula"), opt("2", "Paulo"), opt("3", "Carla Paula"), opt("4", "Paula")];
  assert.deepEqual(names(searchOptions(options, "paul")), ["Paulo", "Paula", "Ana Paula", "Carla Paula"]);
});

check("caps the list and says there is more", () => {
  const options = Array.from({ length: SEARCH_LIMIT + 3 }, (_, i) => opt(String(i), `Cliente ${i}`));
  const r = searchOptions(options, "cliente");
  assert.equal(r.matches.length, SEARCH_LIMIT);
  assert.equal(r.more, true);
  const exact = searchOptions(options.slice(0, SEARCH_LIMIT), "cliente");
  assert.equal(exact.matches.length, SEARCH_LIMIT);
  assert.equal(exact.more, false);
  assert.equal(searchOptions(options, "cliente", 2).matches.length, 2);
});

check("keeps the option objects and leaves the input untouched", () => {
  const options = [opt("2", "Beto"), opt("1", "Abel Beto")];
  const r = searchOptions(options, "beto");
  assert.equal(r.matches[0], options[0]);
  assert.deepEqual(options.map((o) => o.id), ["2", "1"]);
});

console.log(`\n✅ search-options: ${passed} checks passed.`);
