import type { LogicRule, Field, LogicCondition } from '@/types';
import { isAnswerEmpty } from '@/lib/submission-format';

/**
 * Évalue toutes les règles logiques d'un formulaire et retourne les champs visibles
 */
export function evaluateLogicRules(
  rules: LogicRule[],
  responses: Record<string, any>,
  fields: Field[]
): Set<string> {
  // Étape 1 : identifier les champs qui sont cibles d'au moins une règle show_field
  // Ces champs sont cachés par défaut — automatiquement, sans toggle manuel
  const targetsOfShowRules = new Set(
    rules
      .filter(r => r.action_type === 'show_field')
      .map(r => r.target_field_id)
      .filter((id): id is string => !!id)
  );

  // Étape 2 : construire l'ensemble des champs visibles
  const visibleIds = new Set<string>();

  for (const field of fields) {
    if (targetsOfShowRules.has(field.id)) {
      // Caché par défaut — visible seulement si une règle show_field le cible ET ses conditions sont vraies
      const shown = rules
        .filter(r => r.action_type === 'show_field' && r.target_field_id === field.id)
        .some(r => evaluateConditions(r.conditions, r.conditions_operator, responses));
      if (shown) visibleIds.add(field.id);
    } else {
      // Visible par défaut — caché seulement si une règle hide_field le cible ET ses conditions sont vraies
      const hidden = rules
        .filter(r => r.action_type === 'hide_field' && r.target_field_id === field.id)
        .some(r => evaluateConditions(r.conditions, r.conditions_operator, responses));
      if (!hidden) visibleIds.add(field.id);
    }
  }

  return visibleIds;
}

/**
 * Évalue un ensemble de conditions reliées par ET/OU
 */
export function evaluateConditions(
  conditions: LogicCondition[],
  operator: 'AND' | 'OR',
  responses: Record<string, any>
): boolean {
  if (!conditions || conditions.length === 0) return false;
  const results = conditions.map(c => evaluateSingleCondition(c, responses));
  return operator === 'AND' ? results.every(Boolean) : results.some(Boolean);
}

/**
 * Évalue une seule condition logique
 */
export function evaluateSingleCondition(
  condition: LogicCondition,
  responses: Record<string, any>
): boolean {
  const raw = responses[condition.source_field_id];

  // Ces deux-là ne comparent rien : ils regardent seulement si la question a
  // reçu une réponse. Ils passent donc avant toute normalisation en texte, sans
  // quoi la réponse `0` — parfaitement valable sur une échelle — serait déclarée
  // vide, et le répondant le plus critique verrait la mauvaise branche.
  if (condition.operator === 'is_filled') return !isAnswerEmpty(raw);
  if (condition.operator === 'is_empty') return isAnswerEmpty(raw);

  // Si la réponse est un tableau (par exemple choix multiple), on normalise
  let value = '';
  if (Array.isArray(raw)) {
    // Si c'est un tableau, on peut vérifier l'égalité ou si ça contient
    value = JSON.stringify(raw);
  } else {
    value = String(raw ?? '');
  }
  
  const target = condition.value;

  switch (condition.operator) {
    case 'equals':
      if (Array.isArray(raw)) {
        return raw.includes(target);
      }
      return value === target;

    case 'not_equals':
      if (Array.isArray(raw)) {
        return !raw.includes(target);
      }
      return value !== target;

    case 'contains':
      if (Array.isArray(raw)) {
        return raw.includes(target);
      }
      return value.toLowerCase().includes(target.toLowerCase());

    case 'not_contains':
      if (Array.isArray(raw)) {
        return !raw.includes(target);
      }
      return !value.toLowerCase().includes(target.toLowerCase());

    case 'greater_than':
      return Number(value) > Number(target);

    case 'less_than':
      return Number(value) < Number(target);

    default:
      return false;
  }
}