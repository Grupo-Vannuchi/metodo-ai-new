import { z } from "zod";
import { GROUP_ADD_MAX_CONTACTS, INVITE_TEXT_MAX } from "@/lib/whatsapp/group-add/core";

/**
 * What the actions of "Adicionar a grupo do WhatsApp" accept. They are public endpoints (server actions), so whatever
 * arrives is parsed here before anything is read or written; an input that does not fit is `invalid`.
 */

const id = z.string().min(1).max(64);

/**
 * A group's JID as Evolution gives it: the new style (`120363…@g.us`) or the old one (`<phone>-<timestamp>@g.us`). A
 * person's JID (`…@s.whatsapp.net`, `…@lid`) is not a group.
 */
export const GROUP_JID_PATTERN = /^\d+(-\d+)?@g\.us$/;
/** The length cap comes first: no JID is anywhere near it. */
export const groupJidSchema = z.string().max(64).regex(GROUP_JID_PATTERN);

/**
 * What the round takes: the contacts of a folder, or the ones marked in the list (1 to 1,000, the most a round holds).
 * `folderId: null` is "no folder" and must be sent as null: a key that is missing is an error, never the contacts that
 * are in no folder by accident.
 */
export const groupAddSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("folder"), folderId: id.nullable() }),
  z.object({ kind: z.literal("contacts"), contactIds: z.array(id).min(1).max(GROUP_ADD_MAX_CONTACTS) }),
]);

/** The review before a round: the group and the source. It reads and writes nothing, so it takes no text. */
export const groupAddPreviewSchema = z.object({
  source: groupAddSourceSchema,
  groupJid: groupJidSchema,
});

/** The start of a round: what the preview takes, and the invite text (trimmed first, then 1 to 1,000 characters). */
export const groupAddStartSchema = groupAddPreviewSchema.extend({
  inviteText: z.string().trim().min(1).max(INVITE_TEXT_MAX),
});

/** The id of a round, as pause, resume, cancel and poke get it. */
export const groupAddRunIdSchema = id;

export type GroupAddPreviewInput = z.infer<typeof groupAddPreviewSchema>;
export type GroupAddStartInput = z.infer<typeof groupAddStartSchema>;
