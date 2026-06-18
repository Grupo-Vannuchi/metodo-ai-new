import { onlyDigits } from "@/lib/document";
import type { ProfileInput } from "@/lib/validations/profile";

/** Normalize the core fields captured at account creation into stored form. */
export function coreProfileData(input: {
  phone: string;
  documentType: "CPF" | "CNPJ";
  document: string;
}) {
  return {
    phone: onlyDigits(input.phone),
    documentType: input.documentType,
    document: onlyDigits(input.document),
  };
}

const blankToNull = (value?: string): string | null => {
  const v = (value ?? "").trim();
  return v === "" ? null : v;
};

/** Map a validated profile form into Prisma `UserProfile` write data. */
export function fullProfileData(input: ProfileInput) {
  return {
    ...coreProfileData(input),
    position: blankToNull(input.position),
    birthDate: input.birthDate ? new Date(input.birthDate) : null,
    avatarUrl: blankToNull(input.avatarUrl),
    addressZip: blankToNull(input.addressZip),
    addressStreet: blankToNull(input.addressStreet),
    addressNumber: blankToNull(input.addressNumber),
    addressCity: blankToNull(input.addressCity),
    addressState: blankToNull(input.addressState)?.toUpperCase() ?? null,
  };
}
