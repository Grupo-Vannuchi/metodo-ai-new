"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/tenant";
import { fullProfileData } from "@/lib/profile";
import { profileSchema } from "@/lib/validations/profile";

export type ProfileResult = { ok: true } | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

/** Update the signed-in user's name + profile (upserts the 1:1 profile row). */
export async function updateProfile(formData: FormData): Promise<ProfileResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    documentType: formData.get("documentType"),
    document: formData.get("document"),
    position: formData.get("position"),
    birthDate: formData.get("birthDate"),
    avatarUrl: formData.get("avatarUrl"),
    addressZip: formData.get("addressZip"),
    addressStreet: formData.get("addressStreet"),
    addressNumber: formData.get("addressNumber"),
    addressCity: formData.get("addressCity"),
    addressState: formData.get("addressState"),
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const data = fullProfileData(parsed.data);
  try {
    await prisma.user.update({
      where: { id: ctx.userId },
      data: {
        name: parsed.data.name,
        profile: { upsert: { create: data, update: data } },
      },
    });
    revalidatePath("/app/settings/profile");
    revalidatePath("/app/settings/team");
    return { ok: true };
  } catch (error) {
    console.error("Failed to update profile", error);
    return { ok: false, error: "unknown" };
  }
}
