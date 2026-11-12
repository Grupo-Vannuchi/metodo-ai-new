/**
 * Self-check for the pure rules of contacts in several folders (no DB, no
 * network, no env). Run with `npm run check:folders`; exits non-zero on the
 * first failure.
 */
import assert from "node:assert/strict";
import {
  applyFolderDrop,
  buildContactColumns,
  mergeLinkPlan,
  type BoardContact,
  type FolderColumn,
} from "../src/lib/crm/contact-folders-core";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

type Item = { id: string };
const it = (id: string): Item => ({ id });

// Base: U=[], A=[c1,c2], B=[c3], C=[c1]
const base = (): FolderColumn<Item>[] => [
  { id: null, name: "", items: [] },
  { id: "A", name: "A", items: [it("c1"), it("c2")] },
  { id: "B", name: "B", items: [it("c3")] },
  { id: "C", name: "C", items: [it("c1")] },
];

const ids = (cols: FolderColumn<Item>[]) =>
  Object.fromEntries(cols.map((c) => [c.id ?? "U", c.items.map((i) => i.id)]));

check("move c1 A→B", () => {
  const r = applyFolderDrop(base(), ["c1"], "A", "B", "move");
  assert.deepEqual(ids(r), { U: [], A: ["c2"], B: ["c1", "c3"], C: ["c1"] });
});

check("add c1 A→B", () => {
  const r = applyFolderDrop(base(), ["c1"], "A", "B", "add");
  assert.deepEqual(ids(r), { U: [], A: ["c1", "c2"], B: ["c1", "c3"], C: ["c1"] });
});

check("move c1 A→C keeps one copy in C", () => {
  const r = applyFolderDrop(base(), ["c1"], "A", "C", "move");
  assert.deepEqual(ids(r), { U: [], A: ["c2"], B: ["c3"], C: ["c1"] });
});

check("move c1 A→Sem pasta takes it out of every folder", () => {
  for (const mode of ["move", "add"] as const) {
    const r = applyFolderDrop(base(), ["c1"], "A", null, mode);
    assert.deepEqual(ids(r), { U: ["c1"], A: ["c2"], B: ["c3"], C: [] });
  }
});

check("from Sem pasta", () => {
  for (const mode of ["move", "add"] as const) {
    const cols = base();
    cols[0].items = [it("c4")];
    const r = applyFolderDrop(cols, ["c4"], null, "A", mode);
    assert.deepEqual(ids(r), { U: [], A: ["c4", "c1", "c2"], B: ["c3"], C: ["c1"] });
  }
});

check("dropping on the open folder changes nothing", () => {
  const cols = base();
  const r = applyFolderDrop(cols, ["c1"], "A", "A", "move");
  assert.deepEqual(ids(r), ids(base()));
  assert.equal(r, cols);
});

check("ids outside the source are ignored", () => {
  const cols = base();
  const r = applyFolderDrop(cols, ["c3"], "A", "B", "move");
  assert.deepEqual(ids(r), ids(base()));
  assert.equal(r, cols);
});

check("buildContactColumns", () => {
  const folders = [
    { id: "F1", name: "Clientes" },
    { id: "F2", name: "Feira" },
  ];
  const mk = (id: string, folderIds: string[]): BoardContact => ({
    id,
    name: id,
    email: null,
    phone: null,
    companyName: null,
    folderIds,
  });
  const cols = buildContactColumns(folders, [mk("x", ["F2", "F1"]), mk("y", []), mk("z", ["gone"])]);
  const card = (id: string, folderNames: string[]) => ({
    id,
    name: id,
    email: null,
    phone: null,
    companyName: null,
    folderNames,
  });
  assert.deepEqual(cols, [
    { id: null, name: "", contacts: [card("y", []), card("z", [])] },
    { id: "F1", name: "Clientes", contacts: [card("x", ["Clientes", "Feira"])] },
    { id: "F2", name: "Feira", contacts: [card("x", ["Clientes", "Feira"])] },
  ]);
});

check("mergeLinkPlan", () => {
  const plan = mergeLinkPlan(
    ["F1"],
    [
      { id: "l1", folderId: "F1" },
      { id: "l2", folderId: "F2" },
      { id: "l3", folderId: "F2" },
      { id: "l4", folderId: "F3" },
    ],
  );
  assert.deepEqual(plan, { deleteIds: ["l1", "l3"], repointIds: ["l2", "l4"] });
});

console.log(`\n${passed} checks passed`);
