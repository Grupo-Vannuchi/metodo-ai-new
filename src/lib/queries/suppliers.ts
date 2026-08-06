import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type SupplierRow = {
  id: string;
  name: string;
  tradeName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  city: string | null;
  uf: string | null;
  notes: string | null;
  active: boolean;
};

export async function listSuppliers(organizationId: string): Promise<SupplierRow[]> {
  return tenantDb(organizationId).supplier.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take: 1000,
    select: {
      id: true,
      name: true,
      tradeName: true,
      document: true,
      email: true,
      phone: true,
      contactName: true,
      city: true,
      uf: true,
      notes: true,
      active: true,
    },
  });
}
