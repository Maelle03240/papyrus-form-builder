import { describe, it, expect } from 'vitest';
import {
  evaluateLogicRules,
  evaluateConditions,
  evaluateSingleCondition
} from '@/lib/logic-evaluation';
import type { Field, LogicRule, LogicCondition } from '@/types';

/**
 * Ces tests fixent le comportement actuel de la logique conditionnelle avant que
 * la phase 2 ne l'étende avec une visibilité portée par le champ lui-même.
 * Ils sont le filet : si le rendu public se met à afficher — ou pire, à masquer —
 * une question qu'il ne devrait pas, c'est ici que ça doit casser en premier.
 */

function field(id: string): Field {
  return {
    id,
    form_id: 'form-1',
    type: 'short_text',
    label: { fr: id },
    description: { fr: '' },
    placeholder: { fr: '' },
    options: [],
    required: false,
    field_order: 0,
    validation: {}
  };
}

function rule(
  action: LogicRule['action_type'],
  target: string,
  conditions: LogicCondition[],
  operator: 'AND' | 'OR' = 'AND'
): LogicRule {
  return {
    id: `rule-${target}-${action}`,
    form_id: 'form-1',
    conditions,
    conditions_operator: operator,
    action_type: action,
    target_field_id: target,
    rule_order: 0
  };
}

const eq = (source: string, value: string): LogicCondition => ({
  source_field_id: source,
  operator: 'equals',
  value
});

describe('evaluateLogicRules', () => {
  const fields = [field('q1'), field('q2'), field('q3')];

  it('rend tout visible quand aucune règle n’existe', () => {
    const visible = evaluateLogicRules([], {}, fields);
    expect([...visible].sort()).toEqual(['q1', 'q2', 'q3']);
  });

  it('masque par défaut un champ ciblé par une règle « afficher »', () => {
    // La cible d'une règle show_field est cachée tant que la condition est fausse :
    // c'est ce qui évite d'avoir à cocher « masqué au départ » à la main.
    const rules = [rule('show_field', 'q2', [eq('q1', 'oui')])];

    expect(evaluateLogicRules(rules, {}, fields).has('q2')).toBe(false);
    expect(evaluateLogicRules(rules, { q1: 'non' }, fields).has('q2')).toBe(false);
    expect(evaluateLogicRules(rules, { q1: 'oui' }, fields).has('q2')).toBe(true);
  });

  it('laisse visibles les champs non ciblés', () => {
    const rules = [rule('show_field', 'q2', [eq('q1', 'oui')])];
    const visible = evaluateLogicRules(rules, {}, fields);
    expect(visible.has('q1')).toBe(true);
    expect(visible.has('q3')).toBe(true);
  });

  it('masque un champ visible par défaut quand une règle « masquer » se déclenche', () => {
    const rules = [rule('hide_field', 'q3', [eq('q1', 'non')])];

    expect(evaluateLogicRules(rules, { q1: 'oui' }, fields).has('q3')).toBe(true);
    expect(evaluateLogicRules(rules, { q1: 'non' }, fields).has('q3')).toBe(false);
  });

  it('affiche dès qu’une seule règle « afficher » est satisfaite', () => {
    const rules = [
      rule('show_field', 'q3', [eq('q1', 'a')]),
      rule('show_field', 'q3', [eq('q2', 'b')])
    ];

    expect(evaluateLogicRules(rules, { q2: 'b' }, fields).has('q3')).toBe(true);
    expect(evaluateLogicRules(rules, { q1: 'z', q2: 'z' }, fields).has('q3')).toBe(false);
  });

  it('ignore les règles de saut pour le calcul de visibilité', () => {
    const rules = [rule('jump_to', 'q3', [eq('q1', 'oui')])];
    expect(evaluateLogicRules(rules, { q1: 'oui' }, fields).has('q3')).toBe(true);
  });
});

describe('evaluateConditions', () => {
  const responses = { q1: 'oui', q2: 'non' };

  it('exige toutes les conditions en ET', () => {
    expect(evaluateConditions([eq('q1', 'oui'), eq('q2', 'non')], 'AND', responses)).toBe(true);
    expect(evaluateConditions([eq('q1', 'oui'), eq('q2', 'oui')], 'AND', responses)).toBe(false);
  });

  it('suffit d’une condition en OU', () => {
    expect(evaluateConditions([eq('q1', 'non'), eq('q2', 'non')], 'OR', responses)).toBe(true);
    expect(evaluateConditions([eq('q1', 'non'), eq('q2', 'oui')], 'OR', responses)).toBe(false);
  });

  it('renvoie faux sur une liste vide', () => {
    // Volontaire : une règle sans condition ne doit rien déclencher, sinon elle
    // masquerait ou afficherait en permanence.
    expect(evaluateConditions([], 'AND', responses)).toBe(false);
    expect(evaluateConditions([], 'OR', responses)).toBe(false);
  });
});

describe('evaluateSingleCondition', () => {
  it('compare une réponse simple', () => {
    expect(evaluateSingleCondition(eq('q1', 'oui'), { q1: 'oui' })).toBe(true);
    expect(evaluateSingleCondition(eq('q1', 'oui'), { q1: 'non' })).toBe(false);
  });

  it('traite une réponse absente comme une chaîne vide', () => {
    expect(evaluateSingleCondition(eq('q1', ''), {})).toBe(true);
    expect(evaluateSingleCondition(eq('q1', 'oui'), {})).toBe(false);
  });

  it('teste l’appartenance sur un choix multiple', () => {
    const responses = { q1: ['a', 'b'] };
    expect(evaluateSingleCondition(eq('q1', 'a'), responses)).toBe(true);
    expect(evaluateSingleCondition(eq('q1', 'c'), responses)).toBe(false);
    expect(
      evaluateSingleCondition(
        { source_field_id: 'q1', operator: 'not_equals', value: 'c' },
        responses
      )
    ).toBe(true);
  });

  it('cherche une sous-chaîne sans tenir compte de la casse', () => {
    const responses = { q1: 'Bonjour le Monde' };
    expect(
      evaluateSingleCondition({ source_field_id: 'q1', operator: 'contains', value: 'MONDE' }, responses)
    ).toBe(true);
    expect(
      evaluateSingleCondition(
        { source_field_id: 'q1', operator: 'not_contains', value: 'au revoir' },
        responses
      )
    ).toBe(true);
  });

  it('compare numériquement', () => {
    const responses = { age: '30' };
    expect(
      evaluateSingleCondition({ source_field_id: 'age', operator: 'greater_than', value: '18' }, responses)
    ).toBe(true);
    expect(
      evaluateSingleCondition({ source_field_id: 'age', operator: 'less_than', value: '18' }, responses)
    ).toBe(false);
  });
});
