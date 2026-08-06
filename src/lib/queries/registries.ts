import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type RegistryRow = { id: string; name: string; extra: string | null; active: boolean };

/** All three support registries for the "Cadastros" screen. */
export async function listRegistries(organizationId: string): Promise<{
  categories: RegistryRow[];
  units: RegistryRow[];
  warehouses: RegistryRow[];
}> {
  const db = tenantDb(organizationId);
  const [cats, units, whs] = await Promise.all([
    db.supplyCategory.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
    db.supplyUnit.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, abbreviation: true, active: true } }),
    db.warehouse.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, location: true, active: true } }),
  ]);
  return {
    categories: cats.map((c) => ({ id: c.id, name: c.name, extra: null, active: c.active })),
    units: units.map((u) => ({ id: u.id, name: u.name, extra: u.abbreviation ?? null, active: u.active })),
    warehouses: whs.map((w) => ({ id: w.id, name: w.name, extra: w.location ?? null, active: w.active })),
  };
}

/** Active names for the item form's datalists (units use the symbol). */
export async function registryOptions(organizationId: string): Promise<{
  categories: string[];
  units: string[];
  warehouses: string[];
}> {
  const db = tenantDb(organizationId);
  const [cats, units, whs] = await Promise.all([
    db.supplyCategory.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
    db.supplyUnit.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true, abbreviation: true } }),
    db.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  return {
    categories: cats.map((c) => c.name),
    units: units.map((u) => u.abbreviation || u.name),
    warehouses: whs.map((w) => w.name),
  };
}
