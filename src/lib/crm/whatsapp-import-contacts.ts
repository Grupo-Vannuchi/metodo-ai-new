import "server-only";
import type { tenantDb } from "@/lib/tenant-db";

/**
 * The write side of "Adicionar aos contatos" in the inbox (src/app/actions/inbox.ts): new CRM
 * contacts from WhatsApp, filed in the import's folder. Kept out of the "use server" file so it
 * never becomes a public server action and so `check:folders:db` can run it.
 */

type Db = ReturnType<typeof tenantDb>;

export type WhatsappContactRow = { name: string; phone: string };

const CHUNK = 500;

/**
 * Creates the contacts in chunks (one big group shouldn't become one huge statement) and files
 * each chunk in `folderId` through contact_folder_links. `createManyAndReturn` is not in
 * WHERE_OPS of tenantDb (docs/guia/03-multi-tenancy.md), so organizationId goes by hand, in both
 * the contacts and the links. The caller has already proved `folderId` is a folder of this
 * organization (it found or created it through `db`).
 */
export async function createWhatsappContacts(
  db: Db,
  organizationId: string,
  rows: WhatsappContactRow[],
  folderId: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    // One transaction per chunk: contacts without their folder link would be skipped on a retry.
    await db.$transaction(async (tx) => {
      const created = await tx.contact.createManyAndReturn({
        data: rows.slice(i, i + CHUNK).map((r) => ({
          organizationId,
          name: r.name,
          phone: r.phone,
          tags: ["whatsapp"],
          source: "whatsapp-import",
        })),
        select: { id: true },
      });
      await tx.contactFolderLink.createMany({
        data: created.map((c) => ({ organizationId, contactId: c.id, folderId })),
      });
    });
  }
}
