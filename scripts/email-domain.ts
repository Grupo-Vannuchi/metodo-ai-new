/**
 * Platform-team command: assign a sender domain — already VERIFIED in the
 * platform's Resend dashboard — to ONE organization; list; remove.
 *
 *   npm run email:dominio -- list
 *   npm run email:dominio -- add <domain> <org-slug> [--yes]
 *   npm run email:dominio -- remove <domain> [--yes]
 *
 * Production (README §8): npx tsx --env-file=.env.supabase scripts/email-domain.ts <same args>
 * Connects to DIRECT_URL (when set) or DATABASE_URL. Writes to a non-local
 * database require --yes. System context: raw Prisma, organizationId explicit.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { isPlatformDomain, normalizeDomain } from "../src/lib/email-broadcast/sender-domain";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const USAGE = [
  "Uso:",
  "  npm run email:dominio -- list",
  "  npm run email:dominio -- add <dominio> <slug-da-empresa> [--yes]",
  "  npm run email:dominio -- remove <dominio> [--yes]",
].join("\n");

const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!url) fail("DIRECT_URL/DATABASE_URL não definido.");
if (!/^postgres(ql)?:\/\//.test(url)) {
  fail('URL do banco malformada: ela precisa começar com "postgresql://".');
}
let host: string;
try {
  host = new URL(url).hostname;
} catch {
  // Never echo the URL: it holds the password.
  fail('URL do banco malformada: não foi possível interpretá-la (senha com "#", "/" ou "@" precisa ser codificada).');
}
const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const [command, ...rest] = args.filter((a) => a !== "--yes");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

/** Writes outside localhost need an explicit --yes (checked before touching the DB). */
function confirmWrite(): void {
  if (!isLocal && !yes) {
    fail(`Banco de destino: ${host}. Para gravar fora do ambiente local, repita o comando com --yes.`);
  }
}

async function list(): Promise<void> {
  const rows = await prisma.emailSenderDomain.findMany({ orderBy: { domain: "asc" } });
  if (rows.length === 0) {
    console.log("Nenhum domínio liberado.");
    return;
  }
  const orgs = await prisma.organization.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.organizationId))] } },
    select: { id: true, slug: true, name: true },
  });
  const byId = new Map(orgs.map((o) => [o.id, o]));
  for (const r of rows) {
    const o = byId.get(r.organizationId);
    console.log(`${r.domain}  →  ${o ? `${o.slug} (${o.name})` : r.organizationId}`);
  }
}

async function add(rawDomain: string, slug: string): Promise<void> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) fail(`Domínio inválido: "${rawDomain}".`);
  if (isPlatformDomain(domain)) {
    fail(`${domain} é o domínio da plataforma e não pode ser liberado para clientes.`);
  }
  const org = await prisma.organization.findFirst({
    where: { slug },
    select: { id: true, slug: true, name: true },
  });
  if (!org) fail(`Empresa com slug "${slug}" não encontrada.`);
  const existing = await prisma.emailSenderDomain.findFirst({ where: { domain } });
  if (existing) {
    if (existing.organizationId === org.id) {
      console.log(`✓ ${domain} já estava liberado para ${org.slug}.`);
      return;
    }
    const owner = await prisma.organization.findFirst({
      where: { id: existing.organizationId },
      select: { slug: true, name: true },
    });
    fail(`${domain} já pertence a outra empresa: ${owner ? `${owner.slug} (${owner.name})` : existing.organizationId}.`);
  }
  await prisma.emailSenderDomain.create({ data: { organizationId: org.id, domain } });
  console.log(`✓ ${domain} liberado para ${org.slug} (${org.name}).`);
  console.log("  Lembrete: o domínio precisa estar Verified no painel do Resend da plataforma.");
}

async function remove(rawDomain: string): Promise<void> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) fail(`Domínio inválido: "${rawDomain}".`);
  const existing = await prisma.emailSenderDomain.findFirst({ where: { domain } });
  if (!existing) fail(`${domain} não está liberado para nenhuma empresa.`);
  await prisma.emailSenderDomain.deleteMany({
    where: { id: existing.id, organizationId: existing.organizationId },
  });
  console.log(`✓ ${domain} removido. Envios em andamento desse domínio pausam no próximo lote.`);
}

async function main(): Promise<void> {
  console.log(`Banco: ${host}`);
  if (command === "list" && rest.length === 0) return list();
  if (command === "add" && rest.length === 2) {
    confirmWrite();
    return add(rest[0], rest[1]);
  }
  if (command === "remove" && rest.length === 1) {
    confirmWrite();
    return remove(rest[0]);
  }
  fail(USAGE);
}

main()
  .catch((e) => {
    console.error(`✖ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
