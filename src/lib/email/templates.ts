import "server-only";
import { renderEmailLayout, paragraphs } from "@/lib/email/layout";

/**
 * Transactional email templates. Each returns `{ subject, html }` and is built
 * on the shared branded layout. Verification / invite / reset / welcome
 * templates are added in their respective phases.
 */

export function renderInviteEmail(opts: {
  orgName: string;
  inviterName: string;
  roleLabel: string;
  acceptUrl: string;
  expiresLabel: string;
}): { subject: string; html: string } {
  return {
    subject: `Convite para a equipe ${opts.orgName} no MétodoAI`,
    html: renderEmailLayout({
      preview: `${opts.inviterName} convidou você para ${opts.orgName}.`,
      heading: "Você foi convidado 🎉",
      bodyHtml: paragraphs(
        `${opts.inviterName} convidou você para participar da equipe ${opts.orgName} no MétodoAI, como ${opts.roleLabel}.`,
        `Clique no botão abaixo para aceitar o convite e criar seu acesso.`,
      ),
      button: { label: "Aceitar convite", url: opts.acceptUrl },
      footnote: `O convite expira em ${opts.expiresLabel}. Se você não esperava por ele, pode ignorar este e-mail.`,
    }),
  };
}

export function renderVerificationEmail(opts: { name: string; verifyUrl: string }): {
  subject: string;
  html: string;
} {
  return {
    subject: "Confirme seu e-mail — MétodoAI",
    html: renderEmailLayout({
      preview: "Confirme seu e-mail para ativar sua conta.",
      heading: `Olá, ${opts.name} 👋`,
      bodyHtml: paragraphs(
        `Falta só um passo para ativar sua conta no MétodoAI: confirmar este e-mail.`,
        `Clique no botão abaixo para confirmar e liberar o acesso.`,
      ),
      button: { label: "Confirmar meu e-mail", url: opts.verifyUrl },
      footnote: "O link expira em 24 horas. Se você não criou esta conta, ignore este e-mail.",
    }),
  };
}

export function renderPasswordResetEmail(opts: { name: string; resetUrl: string }): {
  subject: string;
  html: string;
} {
  return {
    subject: "Redefinir sua senha — MétodoAI",
    html: renderEmailLayout({
      preview: "Link para redefinir sua senha.",
      heading: "Redefinição de senha",
      bodyHtml: paragraphs(
        `Olá, ${opts.name}. Recebemos um pedido para redefinir a senha da sua conta no MétodoAI.`,
        `Clique no botão abaixo para escolher uma nova senha.`,
      ),
      button: { label: "Redefinir senha", url: opts.resetUrl },
      footnote:
        "O link expira em 1 hora. Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.",
    }),
  };
}

export function renderWelcomeEmail(opts: { name: string; appUrl: string }): {
  subject: string;
  html: string;
} {
  return {
    subject: "Bem-vindo ao MétodoAI 🎉",
    html: renderEmailLayout({
      preview: "Sua conta está ativa. Vamos começar!",
      heading: `Bem-vindo, ${opts.name}! 🎉`,
      bodyHtml: paragraphs(
        `Sua conta no MétodoAI está ativa e verificada.`,
        `Comece cadastrando seus contatos, montando seu funil de vendas e convidando sua equipe.`,
      ),
      button: { label: "Abrir o MétodoAI", url: opts.appUrl },
    }),
  };
}
