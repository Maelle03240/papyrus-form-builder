import 'server-only';

import { buildSubmissionPdf } from '@/lib/pdf/submission-pdf';
import { sendEmail, wrapPlainText } from '@/lib/email/send';
import { buildSubmissionColumns, formatSubmissionPairs } from '@/lib/submission-format';
import type { EmailConfig, Form, NotificationSettings } from '@/types';

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
 *
 * Depuis la phase 4, l'accusé de réception a un successeur : `EmailConfig`, qui
 * sait choisir un message selon les réponses et joindre un bon de commande.
 * Quand il est actif, l'accusé de réception ci-dessous s'efface — deux e-mails
 * pour une même inscription seraient une erreur que l'auteur ne découvrirait
 * que par une plainte. La notification interne, elle, part dans tous les cas :
 * elle ne s'adresse pas à la même personne.
 */

/** Variables reconnues dans un objet ou un corps de message. */
const BUILTIN_TOKENS = ['form.title', 'submission.date', 'all_answers'] as const;

export const NOTIFICATION_TOKENS: readonly string[] = BUILTIN_TOKENS;

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

  // L'onglet « E-mails » a la main sur ce qui part au répondant : quand il est
  // actif, l'accusé de réception hérité s'efface plutôt que de doubler l'envoi.
  const supersededByEmailTab = (context.form.email_config as EmailConfig | undefined)?.enabled === true;
  const wantsRespondent = settings.respondent?.enabled === true && !supersededByEmailTab;

  if (!wantsSelf && !wantsRespondent) return result;

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

      const sent = await sendEmail({ to, subject, text: body, html: wrapPlainText(body) });
      if (sent.ok) result.self = true;
      else console.error('Notification interne non envoyée:', sent.error);
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

      let attachment: { filename: string; content: Uint8Array } | undefined;
      if (settings.respondent.attach_pdf) {
        try {
          attachment = {
            filename: 'reponses.pdf',
            content: await buildSubmissionPdf({
              form: context.form,
              responses: context.responses,
              submittedAt: context.submittedAt
            })
          };
        } catch (error) {
          // Un PDF illisible ne doit pas empêcher l'accusé de réception de partir.
          console.error('Génération du PDF des réponses échouée:', error);
        }
      }

      const sent = await sendEmail({
        to: [to],
        fromName,
        replyTo,
        subject,
        text: body,
        html: wrapPlainText(body),
        attachment
      });
      if (sent.ok) result.respondent = true;
      else console.error('Accusé de réception non envoyé:', sent.error);
    }
  }

  return result;
}
