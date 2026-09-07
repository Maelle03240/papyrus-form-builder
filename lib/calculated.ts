import type { Field } from '@/types';
import { isAnswerEmpty } from '@/lib/submission-format';

/**
 * Champs calculés : une valeur en lecture seule, recalculée à chaque frappe et
 * enregistrée avec la réponse.
 *
 * Deux modes, qui couvrent ce que demandent les formulaires d'inscription :
 *
 * · `count` compte les lignes des blocs répétables cités — « nombre de
 *   participants », qui monte dès qu'on ajoute une ligne ;
 * · `sum` additionne la valeur des champs numériques cités.
 *
 * `offset` s'ajoute au résultat. Il existe pour le cas courant du « nombre de
 * participants **plus** l'organisateur », qu'on écrirait sinon en dupliquant une
 * ligne dans le formulaire.
 */

/** Valeur d'un champ calculé, d'après les réponses courantes. */
export function calcFieldValue(field: Field, responses: Record<string, unknown>): number {
  if (field.type !== 'calculated' || !field.calc) return 0;

  const { mode, sources, offset } = field.calc;
  let total = 0;

  for (const source of sources ?? []) {
    const raw = responses[source];
    if (mode === 'count') {
      total += countFilledRows(raw);
    } else {
      total += toNumber(raw);
    }
  }

  const value = total + (offset || 0);

  // Un décompte négatif n'a pas de sens : un décalage de -1 sur un bloc encore
  // vide afficherait « -1 participant ». Une somme, en revanche, peut
  // légitimement être négative — une remise, un avoir.
  return mode === 'count' ? Math.max(0, value) : value;
}

/**
 * Renvoie une copie des réponses où chaque champ calculé porte sa valeur.
 *
 * Appelée à l'envoi, côté serveur : sans elle, la valeur affichée au répondant
 * ne serait nulle part — ni dans le tableau des réponses, ni dans l'export, ni
 * dans la feuille Google, ni dans le PDF.
 *
 * Les champs calculés sont traités dans l'ordre de lecture, ce qui permet à
 * l'un d'additionner le résultat d'un autre placé avant lui.
 */
export function applyCalculatedFields(
  fields: Field[],
  responses: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...responses };

  for (const field of fields) {
    if (field.type !== 'calculated' || !field.calc) continue;
    out[field.id] = calcFieldValue(field, out);
  }

  return out;
}

/**
 * Champs qu'un champ calculé peut citer comme source, selon son mode.
 * Sert à ne proposer dans le constructeur que ce qui produira un nombre.
 */
export function calcSourceCandidates(fields: Field[], mode: 'count' | 'sum'): Field[] {
  if (mode === 'count') return fields.filter((field) => field.type === 'repeater');
  return fields.filter(
    (field) =>
      field.type === 'number' ||
      field.type === 'currency' ||
      field.type === 'rating' ||
      field.type === 'nps' ||
      field.type === 'calculated'
  );
}

/**
 * Lignes d'un bloc répétable qui portent réellement une réponse.
 *
 * Compter toutes les lignes reviendrait à compter la ligne d'accueil, celle que
 * le bloc affiche toujours avant qu'on ait rien saisi : un formulaire auquel
 * personne ne s'est encore inscrit annoncerait déjà un participant. Pire, le
 * total sauterait de zéro à deux à la première frappe — avant la saisie il n'y a
 * aucune réponse enregistrée, donc rien à compter, et juste après il y en a une
 * plus la ligne vide ajoutée depuis.
 *
 * On applique donc la même règle qu'ailleurs : `isAnswerEmpty`. Une ligne vide
 * n'est pas un participant, qu'elle vienne du bloc ou d'un clic sur « Ajouter ».
 */
function countFilledRows(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter((row) => !isAnswerEmpty(row)).length;
}

function toNumber(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== 'string') return 0;
  // Une saisie décimale à la française — « 12,50 » — vaut un nombre, pas zéro.
  const parsed = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}
