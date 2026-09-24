/**
 * Node runtime guard.
 *
 * Producao roda na Hostinger, cuja versao de Node esta travada no major do
 * `.nvmrc` e nao pode ser trocada. Nada mais no repo protege isso: uma
 * dependencia que exija Node mais novo instala limpo na maquina do dev, builda limpo, e so quebra no deploy — `engines` e aviso para o npm, nunca
 * erro (nao ha .npmrc com engine-strict).
 *
 * Este script percorre a arvore instalada e falha quando algum pacote nao roda
 * nesse major. Reporta tambem o patch minimo que a arvore exige, que e o numero
 * a comparar com o `node -v` do servidor.
 *
 * Run: npm run check:node   (requer node_modules instalado)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

type V = [number, number, number];
type Parsed = { v: V; specified: number };

/** Aceita "20", "20.9", "v20.9.0", "20.x" — guarda quantos componentes vieram. */
function parseVersion(raw: string): Parsed | null {
  const m = /^v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(raw.trim());
  if (!m || m[1] === "x" || m[1] === "*") return null;
  const wild = (p?: string) => p === undefined || p === "x" || p === "*";
  const specified = wild(m[2]) ? 1 : wild(m[3]) ? 2 : 3;
  const n = (p?: string) => (wild(p) ? 0 : Number(p));
  return { v: [Number(m[1]), n(m[2]), n(m[3])], specified };
}

const cmp = (a: V, b: V) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function satisfiesComparator(v: V, raw: string): boolean {
  const c = raw.trim();
  if (!c || c === "*" || c === "x") return true;

  // ^ e ~ viram uma janela limitada.
  if (c.startsWith("^") || c.startsWith("~")) {
    const p = parseVersion(c.slice(1));
    if (!p) return true;
    if (cmp(v, p.v) < 0) return false;
    const upper: V = c.startsWith("^")
      ? p.v[0] > 0
        ? [p.v[0] + 1, 0, 0]
        : [0, p.v[1] + 1, 0]
      : [p.v[0], p.v[1] + 1, 0];
    return cmp(v, upper) < 0;
  }

  const m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(c);
  if (!m) return true;
  const p = parseVersion(m[2]);
  if (!p) return true;
  const d = cmp(v, p.v);

  switch (m[1]) {
    case ">=":
      return d >= 0;
    case ">":
      return d > 0;
    case "<=":
      return d <= 0;
    case "<":
      return d < 0;
    default:
      // Sem operador (ou "="), "20" significa a linha 20.x: compara so os
      // componentes que foram escritos.
      for (let i = 0; i < p.specified; i++) if (v[i] !== p.v[i]) return false;
      return true;
  }
}

/** Faixa = OR de grupos AND, como o npm interpreta engines. */
function satisfies(v: V, range: string): boolean {
  // O operador pode vir separado da versao por espaco (">= 8" e comum). Sem
  // colar os dois, o split por espaco abaixo os trataria como comparadores
  // distintos, e o ">= 8" viraria "exatamente a linha 8.x".
  const normalized = range.replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1");
  return normalized.split("||").some((group) => {
    const parts = group.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return true;
    if (parts.includes("-")) return true; // faixa com hifen: raro em engines, nao restringe
    return parts.every((c) => satisfiesComparator(v, c));
  });
}

/** Menor versao do major alvo que satisfaz a faixa, ou null se nenhuma satisfaz. */
function lowestSatisfying(major: number, range: string): V | null {
  for (let minor = 0; minor <= 40; minor++) {
    for (let patch = 0; patch <= 40; patch++) {
      const v: V = [major, minor, patch];
      if (satisfies(v, range)) return v;
    }
  }
  return null;
}

type Dep = { name: string; version: string; range: string };

function collect(dir: string, depth: number, out: Dep[]): void {
  if (depth > 3) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === ".bin") continue;
    const p = join(dir, e.name);
    if (e.name.startsWith("@")) {
      collect(p, depth, out); // pasta de escopo, nao e um pacote
      continue;
    }
    try {
      const pkg = JSON.parse(readFileSync(join(p, "package.json"), "utf8"));
      const range = pkg?.engines?.node;
      if (typeof range === "string" && range.trim()) {
        out.push({ name: pkg.name ?? e.name, version: pkg.version ?? "?", range: range.trim() });
      }
    } catch {
      /* sem package.json legivel — ignora */
    }
    collect(join(p, "node_modules"), depth + 1, out); // deps aninhadas nao hoisted
  }
}

/**
 * Nomes alcancaveis a partir de `dependencies` (ignorando devDependencies em
 * todos os niveis) — ou seja, o que de fato vai parar no runtime. O resto so
 * precisa funcionar na hora do build. A distincao importa: um pacote de lint
 * exigindo Node novo derruba o build, nao a aplicacao.
 */
function runtimeClosure(): Set<string> {
  const root = JSON.parse(readFileSync("package.json", "utf8"));
  const seen = new Set<string>();
  const queue: string[] = Object.keys(root.dependencies ?? {});
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    try {
      const pkg = JSON.parse(readFileSync(join("node_modules", name, "package.json"), "utf8"));
      for (const d of Object.keys(pkg.dependencies ?? {})) if (!seen.has(d)) queue.push(d);
    } catch {
      /* peer opcional nao instalado */
    }
  }
  return seen;
}

function main(): void {
  const nvmrc = readFileSync(".nvmrc", "utf8").trim();
  const major = Number(nvmrc.split(".")[0]);
  if (!Number.isInteger(major)) throw new Error(`.nvmrc ilegivel: ${nvmrc}`);

  const deps: Dep[] = [];
  collect("node_modules", 0, deps);
  if (deps.length === 0) throw new Error("node_modules vazio — rode npm install antes");

  const runtime = runtimeClosure();
  const groups = {
    runtime: { label: "runtime (roda em producao)", deps: [] as Dep[] },
    build: { label: "build (so durante npm run build)", deps: [] as Dep[] },
  };
  for (const d of deps) (runtime.has(d.name) ? groups.runtime : groups.build).deps.push(d);

  console.log(`Node de producao (.nvmrc): ${major}.x`);
  console.log(`Pacotes com engines.node: ${deps.length} (${groups.runtime.deps.length} runtime, ${groups.build.deps.length} build)`);
  console.log("");

  let failed = false;
  for (const g of [groups.runtime, groups.build]) {
    const blocking: Dep[] = [];
    let floor: V = [major, 0, 0];
    let floorBy = "(nada acima de " + major + ".0.0)";

    for (const d of g.deps) {
      const low = lowestSatisfying(major, d.range);
      if (low === null) {
        blocking.push(d);
      } else if (cmp(low, floor) > 0) {
        floor = low;
        floorBy = `${d.name}@${d.version}`;
      }
    }

    if (blocking.length > 0) {
      failed = true;
      console.error(`  ❌ ${g.label}: ${blocking.length} pacote(s) NAO rodam em Node ${major}.x`);
      for (const d of blocking) console.error(`       ${d.name}@${d.version} exige "${d.range}"`);
    } else {
      console.log(`  ✓ ${g.label}: nada acima de ${major}.x`);
      console.log(`      piso: Node ${floor.join(".")}  (por ${floorBy})`);
    }
  }

  console.log("");
  if (failed) {
    console.error(`A Hostinger esta travada em Node ${major}.x e nao pode ser trocada.`);
    console.error("Troque a dependencia ou fixe uma versao anterior dela — senao quebra no deploy.");
    process.exit(1);
  }
  console.log(`✅ Node: a arvore inteira cabe em ${major}.x.`);
}

main();
