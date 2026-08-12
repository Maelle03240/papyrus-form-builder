import 'server-only';

import { Resend } from 'resend';
import { NOTIFICATION_FROM_EMAIL, getResendApiKey } from '@/lib/env';
import { buildSubmissionPdf } from '@/lib/pdf/submission-pdf';
import { buildSubmissionColumns, formatSubmissionPairs } from '@/lib/submission-format';
import type { Form, NotificationSettings } from '@/types';

/**
 * Notifications email déclenchées par une réponse.
 *
 * Deux destinataires possibles, indépendants :
 *  · l'auteur du formulaire (« self ») — « quelqu'un vient de répondre » ;
 *  · le répondant lui-même — accusé de réception, éventuellement avec le PDF
 *    de ses réponses en pièce jointe.
 *
 * Aucune de ces deux envois ne doit faire échouer l'enregistrement d'une
 * réponse : un quota Resend atteint ne doit pas se traduire par une réponse
 * perdue. Toutes les erreurs sont donc journalisées, jamais propagées.
 */

/** Variables reconnues dans un objet ou un corps de message. */
const BUILTIN_TOKENS = ['form.title', 'submission.date', 'all_answers'] as const;

export const NOTIFICATION_TOKENS: readonly string[] = BUILTIN_TOKENS;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Remplace les variables `{{…}}` d'un gabarit.
 *
 * Une variable est soit un nom intégré (`{{form.title}}`), soit le libellé d'une
 * question — c'est ce que produit le sélecteur « Insérer une réponse » de
 * l'interface. Si deux questions portent le même libellé, la première l'emporte ;
 * l'identifiant du champ reste accepté comme forme non ambiguë.
 */
function renderTemplate(
  template: string,
  context: { form: Form; responses: Record<string, unknown>; submittedAt: string }
): string {
  const columns = buildSubmissionColumns(context.form);
  const pairs = formatSubmissionPairs(context.form, context.responses);

  const byLabel = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const column of columns) {
    const value = pairs.find((p) => p.label === column.label)?.value ?? '';
    if (!byLabel.has(column.label.toLowerCase())) byLabel.set(column.label.toLowerCase(), value);
    byId.set(column.key, value);
  }

  const answersBlock = pairs.map((pair) => `${pair.label} : ${pair.value}`).join('\n');

  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawToken: string) => {
    const token = rawToken.trim();

    if (token === 'form.title') return context.form.title;
    if (token === 'submission.date') return new Date(context.submittedAt).toLocaleString('fr-FR');
    if (token === 'all_answers') return answersBlock;

    return byLabel.get(token.toLowerCase()) ?? byId.get(token) ?? '';
  });
}

/** Corps HTML minimal — le message reste du texte, mis en page sobrement. */
function toHtml(body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 16px">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#052139;max-width:600px">${paragraphs}</div>`;
}

/** Adresse email du répondant, d'après le champ désigné ou le premier champ email. */
export function findRespondentAddress(
  form: Form,
  responses: Record<string, unknown>,
  preferredFieldId?: string
): string | null {
  const candidates = (form.fields ?? []).filter((field) => field.type === 'email');
  const ordered = preferredFieldId
    ? [
        ...candidates.filter((f) => f.id === preferredFieldId),
        ...candidates.filter((f) => f.id !== preferredFieldId)
      ]
    : candidates;

  for (const field of ordered) {
    const value = responses[field.id];
    if (typeof value === 'string' && value.includes('@')) return value.trim();
  }
  return null;
}

interface SendContext {
  form: Form;
  responses: Record<string, unknown>;
  submittedAt: string;
  /** Adresse de repli pour la notification interne : le créateur du formulaire. */
  ownerEmail?: string | null;
}

/**
 * Envoie les notifications configurées. Ne lève jamais.
 * Renvoie un résumé exploitable pour les logs.
 */
export async function sendSubmissionNotifications(
  context: SendContext
): Promise<{ self: boolean; respondent: boolean }> {
  const result = { self: false, respondent: false };

  const settings = (context.form.notification_settings ?? {}) as NotificationSettings;
  const wantsSelf = settings.self?.enabled === true;
  const wantsRespondent = settings.respondent?.enabled === true;

  if (!wantsSelf && !wantsRespondent) return result;

  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.warn(
      'Notifications demandées mais RESEND_API_KEY est absente : aucun email envoyé.'
    );
    return result;
  }

  const resend = new Resend(apiKey);

  // --- Notification interne ------------------------------------------------
  if (wantsSelf && settings.self) {
    const recipients = settings.self.to.filter((address) => address.includes('@'));
    const to = recipients.length > 0 ? recipients : context.ownerEmail ? [context.ownerEmail] : [];

    if (to.length === 0) {
      console.warn(`Notification interne sans destinataire (formulaire ${context.form.id}).`);
    } else {
      const subject =
        renderTemplate(settings.self.subject || '', context).trim() ||
        `Nouvelle réponse — ${context.form.title}`;
      const body =
        renderTemplate(settings.self.body || '', context).trim() ||
        `Une nouvelle réponse vient d'être enregistrée.\n\n${formatSubmissionPairs(
          context.form,
          context.responses
        )
          .map((pair) => `${pair.label} : ${pair.value}`)
          .join('\n')}`;

      try {
        const { error } = await resend.emails.send({
          from: `Papyrus <${NOTIFICATION_FROM_EMAIL}>`,
          to,
          subject,
          text: body,
          html: toHtml(body)
        });
        if (error) throw new Error(error.message);
        result.self = true;
      } catch (error) {
        console.error('Notification interne non envoyée:', error);
      }
    }
  }

  // --- Accusé de réception au répondant ------------------------------------
  if (wantsRespondent && settings.respondent) {
    const to = findRespondentAddress(
      context.form,
      context.responses,
      settings.respondent.to_field_id
    );

    if (!to) {
      console.warn(
        `Accusé de réception impossible : aucune adresse email dans la réponse (formulaire ${context.form.id}).`
      );
    } else {
      const subject =
        renderTemplate(settings.respondent.subject || '', context).trim() || context.form.title;
      const body =
        renderTemplate(settings.respondent.body || '', context).trim() ||
        'Merci pour votre réponse.';

      const fromName = settings.respondent.from_name?.trim() || 'Papyrus';
      const replyTo = settings.respondent.reply_to?.trim();

      let attachments: { filename: string; content: string }[] | undefined;
      if (settings.respondent.attach_pdf) {
        try {
          const pdf = await buildSubmissionPdf({
            form: context.form,
            responses: context.responses,
            submittedAt: context.submittedAt
          });
          attachments = [
            {
              filename: 'reponses.pdf',
              content: Buffer.from(pdf).toString('base64')
            }
          ];
        } catch (error) {
          // Un PDF illisible ne doit pas empêcher l'accusé de réception de partir.
          console.error('Génération du PDF des réponses échouée:', error);
        }
      }

      try {
        const { error } = await resend.emails.send({
          from: `${fromName} <${NOTIFICATION_FROM_EMAIL}>`,
          to: [to],
          ...(replyTo && replyTo.includes('@') ? { replyTo } : {}),
          subject,
          text: body,
          html: toHtml(body),
          ...(attachments ? { attachments } : {})
        });
        if (error) throw new Error(error.message);
        result.respondent = true;
      } catch (error) {
        console.error('Accusé de réception non envoyé:', error);
      }
    }
  }

  return result;
}
