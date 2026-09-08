import type { Field, FieldType } from '@/types';

/**
 * Le lien entre l'intitulé d'une question et le contrôle qui y répond.
 *
 * Jusqu'ici la vue publique posait ses questions dans un `<label>` sans `for`,
 * qui n'enveloppait rien : le libellé s'affichait, mais aucun contrôle ne
 * portait de nom. Un lecteur d'écran annonçait « zone de saisie » et rien
 * d'autre — vingt fois de suite sur un formulaire de vingt questions. Un test
 * de navigateur, lui, ne pouvait viser un champ que par son texte d'invite,
 * qui n'est ni obligatoire ni unique.
 *
 * Deux formes de rattachement, parce que deux formes de question :
 *
 * - **un seul contrôle** (saisie, liste déroulante, date) : le contrôle porte
 *   un identifiant, le `<label>` porte le `for` correspondant. Cliquer le
 *   libellé place le curseur dans le champ — ce que `aria-labelledby` seul ne
 *   ferait pas ;
 * - **plusieurs contrôles** (choix, note, matrice, oui/non) : aucun d'eux n'est
 *   « le » champ. Un `<label for>` désignerait arbitrairement le premier bouton.
 *   L'ensemble est donc annoncé comme un groupe nommé par l'intitulé.
 *
 * Les deux cas reçoivent en plus `aria-describedby` vers la description quand
 * il y en a une : elle porte souvent la contrainte (« format JJ/MM/AAAA »), et
 * l'entendre après le nom du champ vaut mieux que de la découvrir en échouant.
 */

/** Attributs à poser tels quels sur un contrôle. Se répandent avec `{...}`. */
export interface ControlAttrs {
  id?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

/**
 * Les types dont la réponse se donne sur plusieurs contrôles.
 *
 * `signature` et les envois de fichier en font partie : ce sont une zone de
 * dessin et un bouton, pas un champ que l'on remplit au clavier.
 */
const GROUPED_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'single_choice',
  'multiple_choice',
  'rating',
  'nps',
  'matrix',
  'yesno',
  'repeater',
  'signature',
  'file',
  'image',
  'video',
  'phone'
]);

/** Les types qui ne posent aucune question : ni nom, ni groupe. */
const SILENT_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'statement',
  'divider',
  'link',
  'hidden'
]);

export function isGroupedField(type: FieldType): boolean {
  return GROUPED_TYPES.has(type);
}

export function isSilentField(type: FieldType): boolean {
  return SILENT_TYPES.has(type);
}

/**
 * Le libellé peut-il être un `<label for>` ?
 *
 * Non pour un groupe : un `<label>` qui ne désigne aucun contrôle est un
 * élément vide au regard de l'accessibilité, et le HTML l'interdit.
 */
export function labelsSingleControl(type: FieldType): boolean {
  return !GROUPED_TYPES.has(type) && !SILENT_TYPES.has(type);
}

export function fieldLabelId(fieldId: string): string {
  return `q-${fieldId}-label`;
}

export function fieldControlId(fieldId: string): string {
  return `q-${fieldId}-control`;
}

export function fieldDescriptionId(fieldId: string): string {
  return `q-${fieldId}-desc`;
}

/**
 * Les attributs du contrôle d'un champ à un seul contrôle.
 *
 * `aria-labelledby` en plus du `for` : la vue « une question par écran » titre
 * ses questions avec un `<h2>`, qui ne peut pas porter de `for`. Les deux vues
 * partagent le même rendu de champ ; c'est donc au champ de porter les deux.
 */
export function controlAttrsFor(field: Pick<Field, 'id' | 'type' | 'description'>): ControlAttrs {
  if (!labelsSingleControl(field.type)) return {};

  const attrs: ControlAttrs = {
    id: fieldControlId(field.id),
    'aria-labelledby': fieldLabelId(field.id)
  };

  if (field.description?.fr) attrs['aria-describedby'] = fieldDescriptionId(field.id);

  return attrs;
}
