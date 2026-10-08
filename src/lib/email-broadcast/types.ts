import type { AudienceStats, CandidateSource } from "./audience-core";
import type { AudienceSelection } from "@/lib/validations/email-broadcast";

/** Shapes shared by the E-mail pages, actions and client components. Types only. */

export type PickedTarget = { kind: "contact" | "company"; id: string; name: string; email: string };

export type CountedOption = { id: string; name: string; count: number };

export type ComposerOptions = {
  contactCount: number;
  tags: { name: string; count: number }[];
  contactFolders: CountedOption[];
  companyCount: number;
  companyFolders: CountedOption[];
};

export type AudiencePreview = {
  stats: AudienceStats;
  invalidEmails: string[];
  sample: { email: string; name: string | null; sources: CandidateSource[] }[];
};

export type ComposerDraft = {
  id: string | null;
  subject: string;
  html: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  audience: AudienceSelection;
  picked: PickedTarget[];
};
