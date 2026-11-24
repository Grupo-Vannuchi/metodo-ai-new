-- Adds the contact's CPF (digits only). Additive: a nullable column; existing rows and code keep working.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "cpf" TEXT;
