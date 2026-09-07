import type { ConditionOperator, Field, FieldType } from '@/types';
import { isAnswerable } from '@/lib/submission-format';
import { COUNTRIES } from '@/lib/constants/countries';

/**
 * Vocabulaire des conditions, partagé par les deux éditeurs.
 *
 * Les règles de logique (`LogicEditor`) et les verrous de visibilité
 * (`ConditionsEditor`) sont évalués par le même code : ils doivent donc proposer
 * exactement les mêmes opérateurs. Deux listes séparées finiraient par diverger,
 * et un auteur passant d'un panneau à l'autre trouverait le même formulaire
 * capable de choses différentes selon l'endroit où il l'écrit.
 */

export interface OperatorChoice {
  value: ConditionOperator;
  label: string;
}

/** Ces deux-là ne comparent rien : le champ de valeur n'a pas lieu d'être. */
export const VALUELESS_OPERATORS: ConditionOperator[] = ['is_filled', 'is_empty'];

const PRESENCE: OperatorChoice[] = [
  { value: 'is_filled', label: 'est renseigné' },
  { value: 'is_empty', label: 'est vide' }
];

export function getOperatorsForFieldType(type: FieldType | string): OperatorChoice[] {
  if (['short_text', 'long_text', 'email', 'url', 'phone', 'address'].includes(type)) {
    return [
      { value: 'equals', label: 'est égal à' },
      { value: 'not_equals', label: 'est différent de' },
      { value: 'contains', label: 'contient' },
      { value: 'not_contains', label: 'ne contient pas' },
      ...PRESENCE
    ];
  }

  if (['number', 'rating', 'nps', 'currency', 'calculated'].includes(type)) {
    return [
      { value: 'equals', label: 'est égal à' },
      { value: 'not_equals', label: 'est différent de' },
      { value: 'greater_than', label: 'est supérieur à' },
      { value: 'less_than', label: 'est inférieur à' },
      ...PRESENCE
    ];
  }

  // Un bloc répétable ne se compare pas : sa réponse est un tableau de lignes.
  // On ne peut en dire que s'il est rempli ou non — pour compter ses lignes, il
  // existe le champ calculé.
  if (type === 'repeater' || type === 'signature' || type === 'file') {
    return PRESENCE;
  }

  return [
    { value: 'equals', label: 'est égal à' },
    { value: 'not_equals', label: 'est différent de' },
    ...PRESENCE
  ];
}

export function operatorNeedsValue(operator: ConditionOperator): boolean {
  return !VALUELESS_OPERATORS.includes(operator);
}

export function isChoiceField(field?: Field): boolean {
  return field
    ? ['single_choice', 'multiple_choice', 'dropdown', 'yesno', 'country'].includes(field.type)
    : false;
}

/**
 * Champs qu'une condition peut interroger.
 *
 * Ne sont exclus que ceux qui ne portent jamais de réponse : interroger une
 * image ou un séparateur donnerait une condition toujours fausse, sans que rien
 * ne l'explique.
 */
export function conditionSourceFields(fields: Field[], excludeId?: string): Field[] {
  return fields.filter((field) => isAnswerable(field) && field.id !== excludeId);
}

/** Valeurs proposées pour un champ dont les réponses sont fermées. */
export function conditionValueChoices(field: Field): { value: string; label: string }[] {
  if (field.type === 'yesno') {
    return [
      { value: 'yes', label: field.validation?.yes_label || 'Oui' },
      { value: 'no', label: field.validation?.no_label || 'Non' }
    ];
  }

  if (field.type === 'country') {
    return COUNTRIES.map((country) => ({ value: country.code, label: country.name }));
  }

  return (field.options ?? []).map((option) => ({
    value: option.id,
    label: option.label?.fr || 'Option sans titre'
  }));
}
