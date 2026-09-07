import 'server-only';

import { buildSubmissionPdf } from '@/lib/pdf/submission-pdf';
import { evaluateFormVisibility } from '@/lib/visibility';
import {
  chooseEmailMessage,
  fallbackMessage,
  pickText,
  renderTemplate,
  type RenderContext
} from '@/lib/email/tokens';
import { parseAddressList, sendEmail, wrapPlainText } from '@/lib/email/send';
import type { EmailConfig, Field, Form, LogicRule, TotalsSnapshot } from '@/types';

/**
 * L'e-mail de confirmation d'une réponse : quel message, à qui, avec quoi.
 *
 * C'est le successeur de l'accusé de réception de `notifications.ts`. Quand
 * `email_config.enabled` vaut vrai, il le remplace — la notification interne à
 * l'auteur, elle, continue de partir. Sans cet arbitrage, un auteur qui règle le
 * nouvel onglet sans penser à l'ancien enverrait deux e-mails à chaque inscrit,
 * et ne le découvrirait que par une plainte.
 */

export interface ConfirmationInput {
  form: Form;
  responses: Record<string, unknown>;
  submittedAt: string;
  language: string;
  invoiceNumber?: string | null;
  projectName?: string;
  pricing?: TotalsSnapshot | null;
}

export type ConfirmationResult =
  | { sent: true; to: string }
  | { sent: false; reason: string };

/**
 * Adresse du répondant.
 *
 * Le champ désigné passe en premier, puis n'importe quel champ e-mail rempli.
 * Seuls les champs restés VISIBLES comptent : un formulaire à deux branches
 * porte souvent un champ e-mail dans chacune, et écrire à celui de la branche
 * abandonnée reviendrait à écrire à une adresse que le répondant n'a pas saisie.
 */
export function findConfirmationRecipient(
  form: Form,
  responses: Record<string, unknown>,
  preferredFieldId?: string
): string | null {
  const visible = evaluateFormVisibility(
    {
      fields: form.fields ?? [],
      sections: form.sections ?? [],
      logic_rules: (form.logic_rules ?? []) as LogicRule[]
    },
    responses
  ).fields;

  const emailFields = (form.fields ?? []).filter((field: Field) => field.type === 'email');
  const ordered = [
    ...emailFields.filter((field) => field.id === preferredFieldId),
    ...emailFields.filter((field) => field.id !== preferredFieldId)
  ];

  for (const pass of [true, false]) {
    for (const field of ordered) {
      if (pass && !visible.has(field.id)) continue;
      const value = responses[field.id];
      if (typeof value === 'string' && value.includes('@')) return value.trim();
    }
  }

  return null;
}

export async function sendConfirmationEmail(
  input: ConfirmationInput
): Promise<ConfirmationResult> {
  const config = input.form.email_config as EmailConfig | undefined;
  if (!config?.enabled) return { sent: false, reason: 'désactivé' };

  const to = findConfirmationRecipient(input.form, input.responses, config.to_field_id);
  if (!to) return { sent: false, reason: 'aucune adresse dans la réponse' };

  const { message } = chooseEmailMessage(config, input.responses);

  const context: RenderContext = {
    form: input.form,
    responses: input.responses,
    submittedAt: input.submittedAt,
    invoiceNumber: input.invoiceNumber,
    projectName: input.projectName,
    pricing: input.pricing
  };

  const fallback = fallbackMessage({
    invoiceNumber: input.invoiceNumber,
    projectName: input.projectName,
    formTitle: input.form.title
  });

  const subjectTemplate = pickText(message?.subject, input.language);
  const bodyTemplate = pickText(message?.body, input.language);

  const subject = subjectTemplate
    ? renderTemplate(subjectTemplate, context)
    : fallback.subject;

  // Le corps est écrit dans un éditeur riche, donc déjà du HTML. Un corps rédigé
  // avant que l'éditeur n'existe — ou collé depuis ailleurs — arrive en texte
  // brut : il est alors mis en page plutôt qu'envoyé en un seul bloc.
  const body = bodyTemplate
    ? renderTemplate(bodyTemplate, context, { html: true })
    : fallback.html;
  const html = looksLikeHtml(body) ? body : wrapPlainText(body);

  // La pièce jointe : réglage du message s'il en porte un, sinon celui du
  // formulaire. Un message de refus n'a pas à emporter un bon de commande.
  const attachPdf = message?.attach_pdf ?? config.attach_pdf ?? true;

  let attachment;
  if (attachPdf) {
    try {
      const pdf = await buildSubmissionPdf({
        form: input.form,
        responses: input.responses,
        submittedAt: input.submittedAt,
        invoiceNumber: input.invoiceNumber,
        projectName: input.projectName,
        pricing: input.pricing
      });
      attachment = {
        filename: `${sanitizeFilename(input.invoiceNumber || input.form.title)}.pdf`,
        content: pdf
      };
    } catch (error) {
      // Un PDF illisible ne doit pas retenir la confirmation : le répondant a
      // besoin de savoir que sa réponse est arrivée, pièce jointe ou non.
      console.error('Génération du PDF échouée, envoi sans pièce jointe:', error);
    }
  }

  const result = await sendEmail({
    to: [to],
    cc: parseAddressList(config.cc),
    bcc: parseAddressList(config.bcc),
    replyTo: config.reply_to,
    fromName: config.from_name?.trim() || input.projectName || 'Papyrus',
    subject,
    html,
    attachment
  });

  return result.ok ? { sent: true, to } : { sent: false, reason: result.error };
}

function looksLikeHtml(value: string): boolean {
  return /<(p|div|br|ul|ol|h[1-6]|table|strong|em|a)\b/i.test(value);
}

/**
 * Nom de fichier sûr pour la pièce jointe.
 *
 * Un titre de formulaire est une chaîne libre : il peut contenir une barre
 * oblique, des accents, ou faire trois lignes. Les clients de messagerie ne s'en
 * accommodent pas tous de la même façon.
 */
function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || 'reponse';
}
