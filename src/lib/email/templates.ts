import "server-only";
import { renderEmailLayout, paragraphs } from "@/lib/email/layout";

/**
 * Transactional email templates. Each returns `{ subject, html }` and is built
 * on the shared branded layout. Verification / invite / reset / welcome
 * templates are added in their respective phases.
 */

export function renderTestEmail(opts: { orgName: string; requestedBy: string }): {
  subject: string;
  html: string;
} {
  return {
    subject: "Teste de e-mail — MétodoAI",
    html: renderEmailLayout({
      preview: "Seu envio de e-mail está funcionando.",
      heading: "E-mail configurado com sucesso ✅",
      bodyHtml: paragraphs(
        `Este é um e-mail de teste enviado a partir das configurações de ${opts.orgName}.`,
        `Se você recebeu esta mensagem na caixa de entrada (e não no spam), o domínio, o DKIM e o SPF estão corretos — os e-mails de convite, verificação e recuperação de senha vão funcionar.`,
        `Disparado por ${opts.requestedBy}.`,
      ),
      footnote: "Você pode ignorar este e-mail — ele serve apenas para validar a configuração.",
    }),
  };
}
