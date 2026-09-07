import { formatAnswer, isAnswerable } from '@/lib/submission-format';
import { formatMoney } from '@/lib/pricing';
import { isUnlocked } from '@/lib/visibility';
import type {
  EmailConfig,
  EmailMessage,
  Field,
  Form,
  MultilingualText,
  TotalsSnapshot
} from '@/types';

/**
 * Jetons `{{…}}` des e-mails de confirmation, et choix du message à envoyer.
 *
 * Ce module est volontairement sans dépendance serveur : le panneau de
 * rédaction s'en sert pour l'aperçu, la route d'envoi pour le message réel. Une
 * seule implémentation, donc aucun écart possible entre ce que l'auteur voit en
 * écrivant et ce que le répondant reçoit — c'est le seul moyen de rendre un
 * aperçu digne de confiance.
 */

// ============================================================================
// Vocabulaire
// ============================================================================

/** Jetons qui ne désignent aucune question. */
export const BUILTIN_TOKENS = [
  'invoice_number',
  'project_name',
  'form_title',
  'submission_date',
  'total',
  'all_answers'
] as const;

export type BuiltinToken = (typeof BUILTIN_TOKENS)[number];

export interface EmailToken {
  /** Ce qui s'écrit entre accolades. */
  token: string;
  /** Ce que l'auteur lit dans le sélecteur. */
  label: string;
  group: 'Informations' | 'Réponses';
}

const BUILTIN_LABELS: Record<BuiltinToken, string> = {
  invoice_number: 'Numéro de bon de commande',
  project_name: 'Nom du projet',
  form_title: 'Titre du formulaire',
  submission_date: 'Date de la réponse',
  total: 'Montant total',
  all_answers: 'Toutes les réponses'
};

/**
 * Types de champ qu'il est sensé d'insérer dans un e-mail.
 *
 * Une signature est une image, un fichier une adresse : les déposer dans une
 * phrase produirait une URL au milieu du texte. Ils restent dans le PDF, où ils
 * ont un sens.
 */
const TOKENABLE_TYPES = new Set([
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'currency',
  'url',
  'date',
  'country',
  'yesno',
  'address',
  'calculated',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'rating',
  'nps'
]);

/** Jeton d'une sous-question de répéteur, sur sa première ligne. */
export function repeaterToken(repeaterId: string, subFieldId: string): string {
  return `${repeaterId}.0.${subFieldId}`;
}

/** Ce que propose le sélecteur « Insérer une réponse ». */
export function emailTokens(form: Form): EmailToken[] {
  const fields = (form.fields ?? []).filter(isAnswerable);

  const fromFields: EmailToken[] = [];
  for (const field of fields) {
    if (TOKENABLE_TYPES.has(field.type)) {
      fromFields.push({
        token: field.id,
        label: fieldLabel(field),
        group: 'Réponses'
      });
      continue;
    }

    // Un répéteur ne s'insère pas en bloc — ce serait un tableau au milieu d'une
    // phrase. Ce sont ses sous-questions, sur la première ligne, qui servent à
    // s'adresser au premier participant par son nom.
    if (field.type === 'repeater' && field.repeater) {
      const item = field.repeater.item_label?.fr || 'Ligne';
      for (const sub of field.repeater.fields) {
        if (!TOKENABLE_TYPES.has(sub.type)) continue;
        fromFields.push({
          token: repeaterToken(field.id, sub.id),
          label: `${sub.label?.fr || sub.id} (${item} 1)`,
          group: 'Réponses'
        });
      }
    }
  }

  const builtins: EmailToken[] = BUILTIN_TOKENS.map((token) => ({
    token,
    label: BUILTIN_LABELS[token],
    group: 'Informations' as const
  }));

  return [...builtins, ...fromFields];
}

function fieldLabel(field: Field): string {
  return field.label?.fr || field.label?.en || field.id;
}

// ============================================================================
// Rendu
// ============================================================================

export interface RenderContext {
  form: Form;
  responses: Record<string, unknown>;
  submittedAt: string;
  invoiceNumber?: string | null;
  projectName?: string;
  pricing?: TotalsSnapshot | null;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Remplace les jetons d'un gabarit.
 *
 * `html` commande l'échappement des valeurs insérées, pas celui du gabarit : le
 * corps est écrit par l'auteur dans un éditeur riche, donc c'est du HTML voulu.
 * Une réponse, elle, est saisie par le répondant — sans échappement, un nom
 * contenant `<b>` déformerait le message de tous les suivants, et une balise
 * mieux choisie ferait bien pire.
 *
 * Un jeton inconnu est laissé tel quel. Un corps collé depuis un autre outil
 * peut contenir ses propres accolades ; les vider silencieusement casserait un
 * gabarit sans rien dire.
 */
export function renderTemplate(
  template: string,
  context: RenderContext,
  { html = false }: { html?: boolean } = {}
): string {
  if (!template) return '';

  const fields = new Map((context.form.fields ?? []).map((f) => [f.id, f] as const));
  const escape = (value: string) => (html ? escapeHtml(value) : value);

  // Le tiret fait partie du motif : un identifiant de champ Papyrus est un UUID,
  // donc il en contient quatre. Sans lui, `{{ea92b44b-d0e7-…}}` ne correspondait
  // à rien et partait tel quel dans l'e-mail du client — la seule façon de s'en
  // apercevoir était de lire un message reçu.
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, rawKey: string) => {
    const key = rawKey.trim();

    switch (key) {
      case 'invoice_number':
        return escape(context.invoiceNumber ?? '');
      case 'project_name':
        return escape(context.projectName ?? '');
      case 'form_title':
        return escape(context.form.title ?? '');
      case 'submission_date':
        return escape(formatDate(context.submittedAt));
      case 'total':
        return escape(
          context.pricing
            ? formatMoney(
                context.pricing.total,
                context.pricing.currency,
                context.pricing.currency_position
              )
            : ''
        );
      case 'all_answers':
        return allAnswers(context, html);
      default:
        break;
    }

    // `répéteur.0.sousQuestion` — la valeur d'une ligne précise.
    const parts = key.split('.');
    if (parts.length === 3) {
      const [repeaterId, indexText, subFieldId] = parts;
      const repeater = fields.get(repeaterId);
      const index = Number(indexText);
      if (repeater?.type === 'repeater' && repeater.repeater && Number.isInteger(index)) {
        const sub = repeater.repeater.fields.find((f) => f.id === subFieldId);
        const rows = context.responses[repeaterId];
        const row = Array.isArray(rows)
          ? (rows[index] as Record<string, unknown> | undefined)
          : undefined;
        if (!sub) return match;
        // Une sous-question a la forme d'un champ pour `formatAnswer` : c'est le
        // même rendu que dans le tableau et l'export, donc les mêmes libellés.
        return escape(formatAnswer(sub as unknown as Field, row?.[subFieldId], '', row));
      }
    }

    const field = fields.get(key);
    if (!field) return match;
    return escape(formatAnswer(field, context.responses[key], '', context.responses));
  });
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('fr-FR');
}

/**
 * Toutes les réponses, en tableau HTML ou en lignes de texte.
 *
 * Les questions restées sans réponse sont écartées : une liste où la moitié des
 * lignes dit « — » se lit comme un formulaire mal rempli, alors que ce sont des
 * questions que le répondant n'a jamais vues.
 */
function allAnswers(context: RenderContext, html: boolean): string {
  const pairs = (context.form.fields ?? [])
    .filter(isAnswerable)
    .map((field) => ({
      label: fieldLabel(field),
      value: formatAnswer(field, context.responses[field.id], '', context.responses)
    }))
    .filter((pair) => pair.value !== '');

  if (pairs.length === 0) return '';

  if (!html) {
    return pairs.map((pair) => `${pair.label} : ${pair.value}`).join('\n');
  }

  const rows = pairs
    .map(
      (pair) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#5b6b78;vertical-align:top">${escapeHtml(
          pair.label
        )}</td><td style="padding:6px 0;color:#052139">${escapeHtml(pair.value).replace(
          /\n/g,
          '<br>'
        )}</td></tr>`
    )
    .join('');

  return `<table style="border-collapse:collapse;font-size:14px;margin:8px 0">${rows}</table>`;
}

// ============================================================================
// Choix du message
// ============================================================================

/**
 * Le message à envoyer : la première règle dont les conditions correspondent,
 * sinon le message par défaut.
 *
 * Une règle sans condition est ignorée. Elle correspondrait à tout, donc elle
 * masquerait toutes celles qui la suivent — et l'auteur, qui la voit comme une
 * règle en cours d'écriture, n'aurait aucun moyen de comprendre pourquoi les
 * autres ne partent plus.
 */
export function chooseEmailMessage(
  config: EmailConfig,
  responses: Record<string, unknown>
): { message: EmailMessage; ruleLabel: string | null } {
  for (const rule of config.rules ?? []) {
    if (!rule.when?.conditions?.length) continue;
    if (isUnlocked(rule.when, responses)) {
      return { message: rule.message, ruleLabel: rule.label || null };
    }
  }
  return { message: config.default_message, ruleLabel: null };
}

/** Texte d'une chaîne multilingue, avec repli sur le français puis l'anglais. */
export function pickText(text: MultilingualText | undefined, language: string): string {
  if (!text) return '';
  return (text[language] || text.fr || text.en || '').trim();
}

/**
 * Message de repli, quand l'auteur a activé les e-mails sans rien rédiger.
 *
 * Il existe parce qu'un formulaire publié avec un corps vide enverrait un
 * message vide : mieux vaut une phrase juste que rien du tout, et le numéro y
 * figure quand il y en a un.
 */
export function fallbackMessage(context: {
  invoiceNumber?: string | null;
  projectName?: string;
  formTitle: string;
}): { subject: string; html: string } {
  const reference = context.invoiceNumber
    ? ` Votre référence est le <b>${escapeHtml(context.invoiceNumber)}</b>.`
    : '';
  const from = context.projectName || context.formTitle;

  return {
    subject: context.invoiceNumber
      ? `Votre bon de commande ${context.invoiceNumber}`
      : `Nous avons bien reçu votre réponse — ${context.formTitle}`,
    html:
      `<p>Bonjour,</p>` +
      `<p>Merci, nous avons bien reçu votre réponse.${reference}</p>` +
      `<p>— ${escapeHtml(from)}</p>`
  };
}

/**
 * Réponses d'exemple pour l'aperçu du panneau de rédaction.
 *
 * Chaque valeur est le libellé de sa question entre crochets : l'auteur voit
 * ainsi *où* atterrit un jeton, sans qu'un exemple plausible puisse être pris
 * pour une vraie réponse.
 */
export function sampleResponses(form: Form): Record<string, unknown> {
  const sample: Record<string, unknown> = {};

  for (const field of (form.fields ?? []).filter(isAnswerable)) {
    if (TOKENABLE_TYPES.has(field.type)) {
      sample[field.id] = `[${fieldLabel(field)}]`;
      continue;
    }
    if (field.type === 'repeater' && field.repeater) {
      const row: Record<string, unknown> = {};
      for (const sub of field.repeater.fields) {
        if (TOKENABLE_TYPES.has(sub.type)) row[sub.id] = `[${sub.label?.fr || sub.id}]`;
      }
      sample[field.id] = [row];
    }
  }

  return sample;
}
