"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { productServiceSchema, type ProductServiceInput } from "@/lib/validations/opportunity";

export type ProductServiceResult =
  | { ok: true; id?: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

function parse(formData: FormData) {
  const price = formData.get("price");
  return productServiceSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    // optional: empty string → undefined (→ null on write)
    price: price == null || price === "" ? undefined : price,
    active: formData.get("active") === "true",
  });
}

/** Map a validated catalog item into Prisma write data. */
function itemData(input: ProductServiceInput) {
  return {
    name: input.name,
    kind: input.kind,
    price: input.price ?? null,
    active: input.active ?? true,
  };
}

export async function createProductService(formData: FormData): Promise<ProductServiceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const item = await tenantDb(ctx.organizationId).productService.create({
      data: { organizationId: ctx.organizationId, ...itemData(parsed.data) },
      select: { id: true },
    });
    revalidatePath("/app/crm/products");
    return { ok: true, id: item.id };
  } catch (error) {
    console.error("Failed to create product/service", error);
    return { ok: false, error: "unknown" };
  }
}

export async function updateProductService(id: string, formData: FormData): Promise<ProductServiceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    await tenantDb(ctx.organizationId).productService.updateMany({
      where: { id },
      data: itemData(parsed.data),
    });
    revalidatePath("/app/crm/products");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update product/service", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteProductService(id: string): Promise<ProductServiceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    await tenantDb(ctx.organizationId).productService.deleteMany({ where: { id } });
    revalidatePath("/app/crm/products");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete product/service", error);
    return { ok: false, error: "unknown" };
  }
}
