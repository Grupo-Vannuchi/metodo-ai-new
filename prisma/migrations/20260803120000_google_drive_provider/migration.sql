-- Add the GOOGLE_DRIVE integration provider (per-user OAuth for Drive mirroring).
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'GOOGLE_DRIVE';
