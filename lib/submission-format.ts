import type { Field, Form } from '@/types';

/**
 * Mise en forme lisible d'une réponse.
 *
 * Cette logique existait en trois exemplaires — le tableau des réponses, l'export
 * Excel, et rien du tout côté serveur. Elle est désormais partagée par le tableau,
 * l'export, la synchronisation Google Sheets, le PDF récapitulatif et les emails
 * de notification : une colonne affichée dans l'interface porte exactement le même
 * texte que la cellule écrite dans la feuille de calcul.
 */

export interface SubmissionColumn {
  /** Identifiant du champ — clé dans `submission.responses`. */
  key: string;
  /** Libellé affiché en en-tête. */
  label: string;
  field: Field;
}

/**
 * Une réponse est-elle vide ?
 *
 * Règle unique, partagée par la validation du navigateur et celle du serveur.
 * Les deux en avaient chacune une version, et elles ne disaient pas la même
 * chose : le client testait `!valeur`, ce qui déclare vide **la réponse `0`**.
 * Sur une échelle de notation qui commence à zéro, le répondant le plus critique
 * — précisément celui qu'on veut entendre — se voyait refuser l'envoi de son
 * formulaire, sans comprendre pourquoi.
 *
 * `false` est également une réponse valable, pour un futur champ de consentement.
 */
export function isAnswerEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  // Un nombre (0 compris) ou un booléen (false compris) est une réponse.
  return false;
}

/** Types de champ qui ne collectent aucune réponse. */
const NON_ANSWERABLE = ['statement', 'image', 'video'] as const;

export function isAnswerable(field: Field): boolean {
  return !(NON_ANSWERABLE as readonly string[]).includes(field.type);
}

/** Colonnes d'un formulaire, dans l'ordre des questions. */
export function buildSubmissionColumns(form: Form): SubmissionColumn[] {
  return [...(form.fields ?? [])]
    .filter(isAnswerable)
    .sort((a, b) => a.field_order - b.field_order)
    .map((field) => ({
      key: field.id,
      label: field.label?.fr || field.label?.en || 'Champ sans nom',
      field
    }));
}

function optionLabel(field: Field, optionId: string): string {
  const option = field.options?.find((o) => o.id === optionId);
  if (option) return option.label?.fr || option.label?.en || optionId;
  const row = field.rows?.find((r) => r.id === optionId);
  if (row) return row.label?.fr || row.label?.en || optionId;
  return optionId;
}

/**
 * Rend une valeur de réponse en texte.
 * `emptyValue` permet d'obtenir `—` dans un tableau et une chaîne vide dans une
 * feuille de calcul, où un tiret polluerait les formules.
 */
export function formatAnswer(field: Field, value: unknown, emptyValue = ''): string {
  if (value === undefined || value === null || value === '') return emptyValue;

  if (['single_choice', 'multiple_choice', 'dropdown'].includes(field.type)) {
    if (Array.isArray(value)) return value.map((v) => optionLabel(field, String(v))).join(', ');
    if (typeof value === 'string') {
      // Une réponse multiple peut arriver sérialisée en CSV d'identifiants.
      if (value.includes(',') && !field.options?.some((o) => o.id === value)) {
        return value
          .split(',')
          .map((v) => optionLabel(field, v.trim()))
          .join(', ');
      }
      return optionLabel(field, value);
    }
  }

  if (field.type === 'matrix' && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([rowId, colId]) => `${optionLabel(field, rowId)} : ${optionLabel(field, String(colId))}`)
      .join(' | ');
  }

  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Une réponse mise à plat : une valeur par colonne, plus les réponses aux
 * sous-questions, qui utilisent des clés `champ__option__sousChamp`.
 */
export function formatSubmissionRow(
  columns: SubmissionColumn[],
  responses: Record<string, unknown>,
  emptyValue = ''
): string[] {
  return columns.map((column) => {
    const direct = formatAnswer(column.field, responses[column.key], emptyValue);

    const subAnswers = Object.entries(responses)
      .filter(([key]) => key !== column.key && key.split('__')[0] === column.key)
      .map(([, value]) => (typeof value === 'object' ? JSON.stringify(value) : String(value)))
      .filter((v) => v !== '' && v !== 'null' && v !== 'undefined');

    if (subAnswers.length === 0) return direct;
    return direct ? `${direct} (${subAnswers.join(' · ')})` : subAnswers.join(' · ');
  });
}

/** Paires « question → réponse » non vides, pour un email ou un PDF. */
export function formatSubmissionPairs(
  form: Form,
  responses: Record<string, unknown>
): { label: string; value: string }[] {
  return buildSubmissionColumns(form)
    .map((column) => ({
      label: column.label,
      value: formatAnswer(column.field, responses[column.key])
    }))
    .filter((pair) => pair.value !== '');
}
