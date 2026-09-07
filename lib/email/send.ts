import 'server-only';

import { Resend } from 'resend';
import { NOTIFICATION_FROM_EMAIL, getResendApiKey } from '@/lib/env';

/**
 * Le seul point d'envoi d'e-mail de Papyrus.
 *
 * Il ne lève jamais. Un envoi est toujours un effet de bord d'autre chose — une
 * réponse enregistrée, une invitation acceptée — et rien de ce qui vient après
 * ne doit dépendre de la disponibilité de Resend. L'appelant reçoit un résultat
 * qu'il peut journaliser ou montrer, jamais une exception à rattraper.
 */

export interface EmailAttachment {
  filename: string;
  /** Contenu binaire — encodé en base64 juste avant l'appel. */
  content: Uint8Array;
}

export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
  /** Version texte. Générée depuis le HTML si elle n'est pas fournie. */
  text?: string;
  fromName?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  attachment?: EmailAttachment;
}

export type SendEmailResult = { ok: true } | { ok: false; error: string };

/** Découpe une liste d'adresses saisie à la main : « a@x.fr, b@y.fr ». */
export function parseAddressList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]/)
    .map((address) => address.trim())
    .filter((address) => address.includes('@') && address.length <= 254);
}

/**
 * Repli texte d'un corps HTML.
 *
 * Sans lui, un client de messagerie en mode texte affiche le balisage brut. La
 * conversion est volontairement grossière : elle sert de repli, pas de second
 * gabarit à maintenir.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<td[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const recipients = input.to.filter((address) => address.includes('@'));
  if (recipients.length === 0) return { ok: false, error: 'Aucun destinataire.' };

  const apiKey = getResendApiKey();
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY n'est pas configurée." };

  const fromName = (input.fromName?.trim() || 'Papyrus').replace(/["<>\r\n]/g, '');

  try {
    const { error } = await new Resend(apiKey).emails.send({
      from: `${fromName} <${NOTIFICATION_FROM_EMAIL}>`,
      to: recipients,
      subject: input.subject,
      html: input.html,
      text: input.text ?? htmlToText(input.html),
      ...(input.replyTo?.includes('@') ? { replyTo: input.replyTo.trim() } : {}),
      ...(input.cc?.length ? { cc: input.cc } : {}),
      ...(input.bcc?.length ? { bcc: input.bcc } : {}),
      ...(input.attachment
        ? {
            attachments: [
              {
                filename: input.attachment.filename,
                content: Buffer.from(input.attachment.content).toString('base64')
              }
            ]
          }
        : {})
    });

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Échec de l'envoi." };
  }
}

/** Enveloppe HTML sobre, appliquée aux messages écrits en texte brut. */
export function wrapPlainText(body: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 16px">${escape(block).replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#052139;max-width:600px">${paragraphs}</div>`;
}
