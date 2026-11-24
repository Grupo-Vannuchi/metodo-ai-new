-- Adds the "Declinada" status (the company declined the deal). Additive: existing rows and code keep working.
ALTER TYPE "OpportunityStatus" ADD VALUE IF NOT EXISTS 'DECLINED';
