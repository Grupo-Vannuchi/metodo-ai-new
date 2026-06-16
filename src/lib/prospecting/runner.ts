import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptCredentials } from "@/lib/integrations/crypto";
import { searchPlacesPage, buildPlacesQuery, type PlaceResult } from "@/lib/prospecting/places";
import { enrichFromWebsite, type SiteContacts } from "@/lib/prospecting/scrape";

/**
 * Extraction job runner. Processes ONE Google Places page per batch (≤20
 * results): discover via Places, enrich each result's website, persist leads,
 * advance the pagination cursor, and report whether the job is complete. The
 * job handler re-enqueues the next batch — keeping each invocation short enough
 * for serverless. Runs as system; the job's org is the tenant boundary.
 */

/** Hard ceiling per job regardless of the requested target. */
export const MAX_TOTAL = 200;
/** Parallel website fetches per batch. */
const ENRICH_CONCURRENCY = 8;

const EMPTY_SITE: SiteContacts = {
  emails: [],
  phones: [],
  whatsapp: [],
  instagram: "",
  facebook: "",
  linkedin: "",
  title: "",
  description: "",
};

const CLOSED = new Set(["CLOSED_PERMANENTLY", "PERMANENTLY_CLOSED"]);

type LeadCreate = Prisma.ExtractedLeadCreateManyInput;

function buildLead(
  organizationId: string,
  jobId: string,
  place: PlaceResult,
  site: SiteContacts,
): LeadCreate {
  const phone = place.phone || site.phones[0] || "";
  let whatsapp = site.whatsapp[0] ?? "";
  if (!whatsapp && phone) {
    const digits = phone.replace(/\D+/g, "");
    if (digits) whatsapp = `https://wa.me/${digits}`;
  }
  return {
    organizationId,
    jobId,
    placeId: place.placeId,
    name: place.name || null,
    segment: place.segment || null,
    address: place.address || null,
    phone: phone || null,
    whatsapp: whatsapp || null,
    email: site.emails[0] || null,
    website: place.website || null,
    instagram: site.instagram || null,
    facebook: site.facebook || null,
    linkedin: site.linkedin || null,
    rating: place.rating,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

async function failJob(jobId: string, error: string): Promise<void> {
  await prisma.extractionJob.updateMany({
    where: { id: jobId },
    data: { status: "FAILED", error },
  });
}

/** Resolve the tenant's own Google Places API key (BYO). */
async function resolveGoogleKey(organizationId: string): Promise<string | null> {
  const conn = await prisma.integrationConnection.findFirst({
    where: { organizationId, provider: "GOOGLE" },
    orderBy: { createdAt: "desc" },
  });
  if (!conn) return null;
  try {
    const key = decryptCredentials(conn.credentialsEnc).apiKey?.trim();
    return key || null;
  } catch {
    return null;
  }
}

export async function runExtractionBatch(jobId: string): Promise<{ done: boolean }> {
  const job = await prisma.extractionJob.findUnique({ where: { id: jobId } });
  if (!job) return { done: true };
  if (job.status === "DONE" || job.status === "FAILED" || job.status === "CANCELED") {
    return { done: true };
  }

  const apiKey = await resolveGoogleKey(job.organizationId);
  if (!apiKey) {
    await failJob(jobId, "no_connection");
    return { done: true };
  }

  await prisma.extractionJob.updateMany({ where: { id: jobId }, data: { status: "RUNNING" } });

  const query = buildPlacesQuery((job.query as Record<string, string>) ?? {});
  const result = await searchPlacesPage(apiKey, query, job.pageToken ?? undefined);
  if (!result.ok) {
    // No leads yet → fail; otherwise stop gracefully as DONE with what we have.
    if (job.total === 0) {
      await failJob(jobId, result.error.tag);
      return { done: true };
    }
    await prisma.extractionJob.updateMany({
      where: { id: jobId },
      data: { status: "DONE", pageToken: null },
    });
    return { done: true };
  }

  const cap = Math.min(job.target ?? MAX_TOTAL, MAX_TOTAL);
  const remaining = Math.max(0, cap - job.total);
  const places = result.page.places
    .filter((p) => !CLOSED.has(p.businessStatus))
    .slice(0, remaining);

  const leads = await mapWithConcurrency(places, ENRICH_CONCURRENCY, async (place) => {
    const site = place.website ? await enrichFromWebsite(place.website) : EMPTY_SITE;
    return buildLead(job.organizationId, jobId, place, site);
  });

  if (leads.length > 0) {
    await prisma.extractedLead.createMany({ data: leads });
  }

  const newTotal = job.total + leads.length;
  const nextToken = result.page.nextPageToken;
  const done = !nextToken || newTotal >= cap;

  await prisma.extractionJob.updateMany({
    where: { id: jobId },
    data: {
      total: newTotal,
      pageToken: done ? null : nextToken,
      status: done ? "DONE" : "RUNNING",
    },
  });

  return { done };
}

/** Run a job to completion in-process (dev / no queue). */
export async function runExtractionToCompletion(jobId: string): Promise<void> {
  // Up to MAX_TOTAL/20 pages, with a small safety margin.
  for (let i = 0; i < 12; i++) {
    const { done } = await runExtractionBatch(jobId);
    if (done) return;
  }
}
