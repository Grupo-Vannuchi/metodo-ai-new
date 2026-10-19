import "server-only";
import type { MailboxSendOutcome } from "../mailbox/core";
import { buildMime, type MimeFile, type MimeMail } from "../microsoft/mime";
import { gmailUploadMode } from "./core";
import { gmailFinishResumable, gmailSendSimple, gmailStartResumable } from "./gmail";

/**
 * One e-mail out of the connected Gmail account (spec 2026-10-19): the MIME is
 * built once, with the files. Up to 5 MB it goes in a single POST (stage
 * "send"); above that, a resumable upload: the start is stage "prepare" (the
 * e-mail has not left), the PUT with the bytes is stage "send". A missing
 * session URL is a "prepare" failure (502). A failure while building the MIME
 * is a "prepare" failure too (status 0). Never throws.
 */
export async function sendGoogleMail(
  token: string,
  mail: Omit<MimeMail, "attachments">,
  files: MimeFile[],
): Promise<MailboxSendOutcome> {
  let mime: Buffer;
  try {
    mime = await buildMime({ ...mail, attachments: files });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      code: null,
      message: e instanceof Error ? e.message : "could not build the e-mail",
      retryAfter: null,
      stage: "prepare",
    };
  }

  if (gmailUploadMode(mime.byteLength) === "simple") {
    const r = await gmailSendSimple(token, mime);
    return r.ok ? { ok: true } : { ...r, stage: "send" };
  }

  const start = await gmailStartResumable(token, mime.byteLength);
  if (!start.ok) return { ...start, stage: "prepare" };
  if (!start.location) {
    return { ok: false, status: 502, code: null, message: "upload session without location", retryAfter: null, stage: "prepare" };
  }
  const done = await gmailFinishResumable(token, start.location, mime);
  return done.ok ? { ok: true } : { ...done, stage: "send" };
}
