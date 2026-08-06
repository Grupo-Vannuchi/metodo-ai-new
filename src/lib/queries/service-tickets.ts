import "server-only";
import { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";

const dec = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));
const IN_HOUSE = ["RECEIVED", "IN_SERVICE", "READY"];

export type ServiceTicketRow = {
  id: string;
  code: string | null;
  equipment: string;
  companyName: string | null;
  status: string;
  description: string | null;
  receivedAt: Date;
  expectedReturn: Date | null;
  returnedAt: Date | null;
  responsible: string | null;
  cost: number | null;
  overdue: boolean;
};

/** List service/custody tickets, urgency-ordered (overdue → in-house → closed). */
export async function listServiceTickets(
  organizationId: string,
  opts?: { status?: string; companyId?: string },
): Promise<ServiceTicketRow[]> {
  const db = tenantDb(organizationId);
  const where: Prisma.ServiceTicketWhereInput = {};
  if (opts?.status && ["RECEIVED", "IN_SERVICE", "READY", "RETURNED", "CANCELED"].includes(opts.status)) {
    where.status = opts.status as Prisma.ServiceTicketWhereInput["status"];
  }
  if (opts?.companyId) where.companyId = opts.companyId;

  const tickets = await db.serviceTicket.findMany({ where, orderBy: { receivedAt: "desc" }, take: 500 });

  const companyIds = [...new Set(tickets.map((tk) => tk.companyId).filter(Boolean))] as string[];
  const companies = companyIds.length
    ? await db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
    : [];
  const companyName = new Map(companies.map((co) => [co.id, co.name]));

  const now = Date.now();
  const rows: ServiceTicketRow[] = tickets.map((tk) => ({
    id: tk.id,
    code: tk.code,
    equipment: tk.equipment,
    companyName: tk.companyId ? companyName.get(tk.companyId) ?? null : null,
    status: tk.status,
    description: tk.description,
    receivedAt: tk.receivedAt,
    expectedReturn: tk.expectedReturn,
    returnedAt: tk.returnedAt,
    responsible: tk.responsible,
    cost: dec(tk.cost),
    overdue: IN_HOUSE.includes(tk.status) && tk.expectedReturn != null && tk.expectedReturn.getTime() < now,
  }));

  const rank = (r: ServiceTicketRow) => (r.overdue ? 0 : IN_HOUSE.includes(r.status) ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || b.receivedAt.getTime() - a.receivedAt.getTime());
  return rows;
}

/** Count of client equipment currently in-house (received/in-service/ready). */
export async function countInHouseEquipment(organizationId: string): Promise<number> {
  return tenantDb(organizationId).serviceTicket.count({ where: { status: { in: ["RECEIVED", "IN_SERVICE", "READY"] } } });
}

/** Client-equipment assets + companies for the ticket form. */
export async function serviceFormOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  const [assets, companies] = await Promise.all([
    db.asset.findMany({
      where: { active: true, nature: { in: ["CLIENT", "THIRD_PARTY"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, ownerCompanyId: true },
      take: 2000,
    }),
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 2000 }),
  ]);
  return {
    assets: assets.map((a) => ({
      id: a.id,
      label: a.code ? `${a.code} · ${a.name}` : a.name,
      name: a.name,
      companyId: a.ownerCompanyId ?? "",
    })),
    companies,
  };
}

export type ServiceFormOptions = Awaited<ReturnType<typeof serviceFormOptions>>;
