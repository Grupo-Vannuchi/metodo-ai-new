/**
 * RFC 5322 messages, built once for every mailbox channel: Graph's MIME
 * endpoints (sendMail and draft creation), Gmail's messages.send, and the SMTP
 * channel, which delivers the built MIME itself (smtp/send.ts). Here nodemailer
 * only builds the message (MailComposer); nothing in this file sends it.
 * No server-only import, so check:email can test it.
 */
import MailComposer from "nodemailer/lib/mail-composer";

export type MimeFile = { filename: string; contentType: string; data: Buffer };

export type MimeMail = {
  from: { name: string | null; address: string };
  to: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  attachments: MimeFile[];
};

/** Non-ASCII names, subjects and file names are encoded by nodemailer. */
export function buildMime(mail: MimeMail): Promise<Buffer> {
  const composer = new MailComposer({
    from: mail.from.name ? { name: mail.from.name, address: mail.from.address } : mail.from.address,
    to: mail.to,
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    headers: mail.headers,
    attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.data, contentType: a.contentType })),
  });
  return composer.compile().build();
}
