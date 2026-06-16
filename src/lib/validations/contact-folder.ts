import { z } from "zod";

export const contactFolderSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome.").max(80),
});

export type ContactFolderInput = z.infer<typeof contactFolderSchema>;
