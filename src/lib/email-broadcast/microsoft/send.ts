import "server-only";
import { attachmentUploadMode, microsoftSendPath } from "./core";
import { buildMime, type MimeFile, type MimeMail } from "./mime";
import {
  graphAddAttachment,
  graphCreateMimeDraft,
  graphDeleteMessage,
  graphSendDraft,
  graphSendMime,
  graphUploadAttachment,
  type GraphFailure,
} from "./graph";

export type MicrosoftSendOutcome = { ok: true } | (GraphFailure & { stage: "prepare" | "send" });

/**
 * One e-mail out of the connected mailbox (spec §6.1): a single sendMail when
 * the base64 MIME fits, else a MIME draft without the files, each file
 * attached (POST under 3 MB, upload session above), then the draft's send. A
 * failure before the send deletes the draft. A timeout ON the send keeps it
 * (it may have gone out). Never throws.
 */
export async function sendMicrosoftMail(
  token: string,
  mail: Omit<MimeMail, "attachments">,
  files: MimeFile[],
): Promise<MicrosoftSendOutcome> {
  try {
    const fileBytes = files.reduce((n, f) => n + f.data.byteLength, 0);
    if (microsoftSendPath(fileBytes, null) === "direct") {
      const b64 = (await buildMime({ ...mail, attachments: files })).toString("base64");
      if (microsoftSendPath(fileBytes, b64.length) === "direct") {
        const r = await graphSendMime(token, b64);
        return r.ok ? { ok: true } : { ...r, stage: "send" };
      }
    }

    const draft = await graphCreateMimeDraft(token, (await buildMime({ ...mail, attachments: [] })).toString("base64"));
    if (!draft.ok) return { ...draft, stage: "prepare" };
    const id = draft.data.id;
    if (!id) return { ok: false, status: 502, code: null, message: "draft without id", retryAfter: null, stage: "prepare" };

    for (const f of files) {
      const r =
        attachmentUploadMode(f.data.byteLength) === "inline"
          ? await graphAddAttachment(token, id, f)
          : await graphUploadAttachment(token, id, f);
      if (!r.ok) {
        await graphDeleteMessage(token, id);
        return { ...r, stage: "prepare" };
      }
    }

    const sent = await graphSendDraft(token, id);
    if (sent.ok) return { ok: true };
    if (sent.status !== 0 && sent.status !== 504) await graphDeleteMessage(token, id);
    return { ...sent, stage: "send" };
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
}
