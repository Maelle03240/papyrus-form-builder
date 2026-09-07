import type { Field, Form } from '@/types';
import { NEVER_REQUIRED_FIELD_TYPES, NON_ANSWERABLE_FIELD_TYPES } from '@/types';
import { COUNTRIES } from '@/lib/constants/countries';

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
export function isAnswerEmpty(value: unknown, depth = 0): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';

  // Une structure dont toutes les valeurs sont vides est vide.
  //
  // Un bloc répétable garde toujours une ligne à l'écran, même intacte : sa
  // réponse vaut donc `[{}]` tant que le répondant n'a rien saisi. Sans cette
  // règle, un bloc obligatoire serait considéré comme rempli par sa seule ligne
  // d'accueil, et l'envoi passerait sans un seul participant.
  if (Array.isArray(value)) {
    if (value.length === 0) return true;
    if (depth >= MAX_EMPTINESS_DEPTH) return false;
    return value.every((item) => isAnswerEmpty(item, depth + 1));
  }

  if (typeof value === 'object') {
    const values = Object.values(value as Record<string, unknown>);
    if (values.length === 0) return true;
    if (depth >= MAX_EMPTINESS_DEPTH) return false;
    return values.every((item) => isAnswerEmpty(item, depth + 1));
  }

  // Un nombre (0 compris) ou un booléen (false compris) est une réponse.
  return false;
}

/**
 * Une réponse imbriquée au-delà de cette profondeur est tenue pour non vide.
 * La borne existe pour qu'une structure cyclique — impossible en JSON, mais la
 * fonction reçoit aussi des objets construits en mémoire — ne fasse pas
 * déborder la pile pendant la validation d'un envoi.
 */
const MAX_EMPTINESS_DEPTH = 4;

export function isAnswerable(field: Field): boolean {
  return !(NON_ANSWERABLE_FIELD_TYPES as readonly string[]).includes(field.type);
}

/**
 * Le champ peut-il être exigé ?
 *
 * `hidden` et `calculated` portent une valeur que le répondant ne saisit pas :
 * l'exiger bloquerait l'envoi sur une question qu'il n'a jamais eue à l'écran,
 * avec un message ne désignant rien de visible.
 */
export function canBeRequired(field: Field): boolean {
  return !(NEVER_REQUIRED_FIELD_TYPES as readonly string[]).includes(field.type);
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
export function formatAnswer(
  field: Field,
  value: unknown,
  emptyValue = '',
  /**
   * Toutes les réponses — nécessaire aux seuls compteurs de quantité, qui vivent
   * dans une clé voisine (`<champ>__qty`) et non dans la valeur du champ.
   */
  bag?: Record<string, unknown>
): string {
  if (value === undefined || value === null || value === '') return emptyValue;

  if (['single_choice', 'multiple_choice', 'dropdown'].includes(field.type)) {
    // « Table de 6 × 3 » plutôt que « Table de 6 » : sans la quantité, la
    // colonne exportée dit qu'une table a été réservée alors qu'il y en a trois,
    // et c'est sur cette colonne que se prépare la salle.
    const withCount = (optionId: string) => {
      const label = optionLabel(field, optionId);
      const count = quantityFor(field, bag, optionId);
      return count > 1 ? `${label} × ${count}` : label;
    };

    if (Array.isArray(value)) return value.map((v) => withCount(String(v))).join(', ');
    if (typeof value === 'string') {
      // Une réponse multiple peut arriver sérialisée en CSV d'identifiants.
      if (value.includes(',') && !field.options?.some((o) => o.id === value)) {
        return value
          .split(',')
          .map((v) => withCount(v.trim()))
          .join(', ');
      }
      return withCount(value);
    }
  }

  if (field.type === 'matrix' && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([rowId, colId]) => `${optionLabel(field, rowId)} : ${optionLabel(field, String(colId))}`)
      .join(' | ');
  }

  if (field.type === 'yesno') {
    const yes = field.validation?.yes_label || 'Oui';
    const no = field.validation?.no_label || 'Non';
    return String(value) === 'yes' ? yes : String(value) === 'no' ? no : emptyValue;
  }

  if (field.type === 'country') {
    const code = String(value).toUpperCase();
    return COUNTRIES.find((country) => country.code === code)?.name ?? String(value);
  }

  if (field.type === 'currency') {
    const amount = String(value).trim();
    if (amount === '') return emptyValue;
    const code = field.validation?.currency_code || DEFAULT_CURRENCY;
    return field.validation?.currency_position === 'after' ? `${amount} ${code}` : `${code} ${amount}`;
  }

  // Un bloc répétable : une ligne par ligne saisie, ses sous-réponses séparées
  // par des points médians. `JSON.stringify` produirait ici du bruit illisible
  // dans une cellule de tableur, et `Array.join` un « [object Object] ».
  if (field.type === 'repeater' && Array.isArray(value)) {
    const itemLabel = field.repeater?.item_label?.fr || 'Ligne';
    return value
      .map((row, index) => {
        const cells = Object.entries((row ?? {}) as Record<string, unknown>)
          .filter(([, cell]) => !isAnswerEmpty(cell))
          .map(([key, cell]) => {
            const sub = field.repeater?.fields?.find((f) => f.id === key);
            const text = Array.isArray(cell) ? cell.join(', ') : String(cell);
            return sub ? `${sub.label?.fr || key} : ${text}` : text;
          });
        return cells.length > 0 ? `${itemLabel} ${index + 1} — ${cells.join(' · ')}` : '';
      })
      .filter(Boolean)
      .join(' | ') || emptyValue;
  }

  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Devise par défaut : Maurice. Papyrus est d'abord utilisé depuis Port-Louis, et
 * la phase 3 remplacera cette constante par la devise du projet.
 */
export const DEFAULT_CURRENCY = 'MUR';

/**
 * Quantité retenue pour une option.
 *
 * La logique complète vit dans `lib/pricing`, mais l'importer ici créerait un
 * cycle : `lib/pricing` dépend de `lib/visibility`, qui dépend de
 * `lib/logic-evaluation`, qui dépend de ce module. La lecture est simple et
 * tolérante — une carte absente ou malformée vaut « une unité ».
 */
const QUANTITY_SUFFIX = '__qty';

function quantityFor(
  field: Field,
  bag: Record<string, unknown> | undefined,
  optionId: string
): number {
  if (field.pricing?.quantity?.enabled !== true) return 1;

  const raw = bag?.[`${field.id}${QUANTITY_SUFFIX}`];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 1;

  const count = Number((raw as Record<string, unknown>)[optionId]);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 1;
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
    const direct = formatAnswer(column.field, responses[column.key], emptyValue, responses);

    const subAnswers = Object.entries(responses)
      .filter(([key]) => key !== column.key && key.split('__')[0] === column.key)
      // Le compteur de quantité partage la racine du champ, mais il est déjà
      // rendu dans le libellé de l'option. Le laisser passer écrirait la carte
      // des quantités en JSON brut au milieu de la cellule.
      .filter(([key]) => !key.endsWith(QUANTITY_SUFFIX))
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
      value: formatAnswer(column.field, responses[column.key], '', responses)
    }))
    .filter((pair) => pair.value !== '');
}
