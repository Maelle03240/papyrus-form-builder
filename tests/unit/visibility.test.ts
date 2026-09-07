import { describe, it, expect } from 'vitest';
import { evaluateFormVisibility, isUnlocked } from '@/lib/visibility';
import type { Field, LogicCondition, LogicRule, Section, VisibilityRule } from '@/types';

/**
 * La phase 2 fait cohabiter deux mécanismes d'affichage. Ces tests fixent leur
 * arbitrage, parce que c'est la seule chose qui empêche deux auteurs — l'un dans
 * le panneau d'une question source, l'autre dans celui de la question cible —
 * d'écrire l'inverse l'un de l'autre sans jamais voir le conflit.
 *
 * Ils fixent aussi le point fixe : une question masquée n'a pas de réponse, et
 * ce qui dépendait de cette réponse doit disparaître avec elle.
 */

function section(id: string, order: number, extra: Partial<Section> = {}): Section {
  return {
    id,
    form_id: 'form-1',
    title: { fr: '' },
    description: { fr: '' },
    section_order: order,
    ...extra
  };
}

function field(id: string, sectionId = 's1', extra: Partial<Field> = {}): Field {
  return {
    id,
    form_id: 'form-1',
    section_id: sectionId,
    type: 'short_text',
    label: { fr: id },
    description: { fr: '' },
    placeholder: { fr: '' },
    options: [],
    required: false,
    field_order: 0,
    validation: {},
    ...extra
  };
}

const when = (source: string, value: string): VisibilityRule => ({
  conditions: [{ source_field_id: source, operator: 'equals', value }],
  operator: 'AND'
});

function rule(
  action: LogicRule['action_type'],
  target: string,
  conditions: LogicCondition[]
): LogicRule {
  return {
    id: `rule-${target}-${action}`,
    form_id: 'form-1',
    conditions,
    conditions_operator: 'AND',
    action_type: action,
    target_field_id: target,
    rule_order: 0
  };
}

describe('isUnlocked', () => {
  it('ouvre un verrou sans condition', () => {
    expect(isUnlocked(undefined, {})).toBe(true);
    expect(isUnlocked({ conditions: [], operator: 'AND' }, {})).toBe(true);
  });

  it('ferme le verrou tant que la condition est fausse', () => {
    const lock = when('q1', 'oui');
    expect(isUnlocked(lock, {})).toBe(false);
    expect(isUnlocked(lock, { q1: 'non' })).toBe(false);
    expect(isUnlocked(lock, { q1: 'oui' })).toBe(true);
  });
});

describe('evaluateFormVisibility — verrou de champ', () => {
  const sections = [section('s1', 0)];

  it('masque un champ dont le verrou est fermé', () => {
    const fields = [field('q1'), field('q2', 's1', { visibility: when('q1', 'oui') })];
    const visible = evaluateFormVisibility({ fields, sections }, {});

    expect(visible.fields.has('q1')).toBe(true);
    expect(visible.fields.has('q2')).toBe(false);
  });

  it('affiche le champ dès que le verrou s’ouvre', () => {
    const fields = [field('q1'), field('q2', 's1', { visibility: when('q1', 'oui') })];
    expect(evaluateFormVisibility({ fields, sections }, { q1: 'oui' }).fields.has('q2')).toBe(true);
  });

  it('combine plusieurs conditions en OU', () => {
    const fields = [
      field('q1'),
      field('q2'),
      field('q3', 's1', {
        visibility: {
          operator: 'OR',
          conditions: [
            { source_field_id: 'q1', operator: 'equals', value: 'a' },
            { source_field_id: 'q2', operator: 'equals', value: 'b' }
          ]
        }
      })
    ];

    expect(evaluateFormVisibility({ fields, sections }, { q2: 'b' }).fields.has('q3')).toBe(true);
    expect(
      evaluateFormVisibility({ fields, sections }, { q1: 'z', q2: 'z' }).fields.has('q3')
    ).toBe(false);
  });
});

describe('evaluateFormVisibility — arbitrage entre les deux mécanismes', () => {
  const sections = [section('s1', 0)];

  it('un verrou ouvert ne rouvre pas ce qu’une règle « masquer » ferme', () => {
    // Le point d'arbitrage : la visibilité est un verrou, jamais un ordre
    // d'affichage. Sans cette règle, deux auteurs travaillant chacun dans son
    // panneau écriraient l'inverse l'un de l'autre.
    const fields = [field('q1'), field('q2', 's1', { visibility: when('q1', 'oui') })];
    const rules = [rule('hide_field', 'q2', [{ source_field_id: 'q1', operator: 'equals', value: 'oui' }])];

    const visible = evaluateFormVisibility({ fields, sections, logic_rules: rules }, { q1: 'oui' });
    expect(visible.fields.has('q2')).toBe(false);
  });

  it('un verrou fermé masque ce qu’une règle « afficher » montrerait', () => {
    const fields = [
      field('q1'),
      field('q2'),
      field('q3', 's1', { visibility: when('q2', 'ok') })
    ];
    const rules = [rule('show_field', 'q3', [{ source_field_id: 'q1', operator: 'equals', value: 'oui' }])];

    expect(
      evaluateFormVisibility({ fields, sections, logic_rules: rules }, { q1: 'oui' }).fields.has('q3')
    ).toBe(false);

    expect(
      evaluateFormVisibility(
        { fields, sections, logic_rules: rules },
        { q1: 'oui', q2: 'ok' }
      ).fields.has('q3')
    ).toBe(true);
  });
});

describe('evaluateFormVisibility — sections', () => {
  it('emporte toutes les questions d’une section masquée par son auteur', () => {
    const sections = [section('s1', 0), section('s2', 1, { hidden: true })];
    const fields = [field('q1', 's1'), field('q2', 's2'), field('q3', 's2')];

    const visible = evaluateFormVisibility({ fields, sections }, {});
    expect(visible.sections.has('s2')).toBe(false);
    expect(visible.fields.has('q2')).toBe(false);
    expect(visible.fields.has('q3')).toBe(false);
    expect(visible.fields.has('q1')).toBe(true);
  });

  it('emporte les questions d’une section dont le verrou est fermé', () => {
    const sections = [section('s1', 0), section('s2', 1, { visibility: when('q1', 'oui') })];
    const fields = [field('q1', 's1'), field('q2', 's2')];

    expect(evaluateFormVisibility({ fields, sections }, {}).fields.has('q2')).toBe(false);
    expect(evaluateFormVisibility({ fields, sections }, { q1: 'oui' }).fields.has('q2')).toBe(true);
  });

  it('n’escamote rien quand les sections n’ont pas été chargées', () => {
    // Une requête qui n'a pas demandé les sections ne doit pas faire disparaître
    // tout le formulaire : c'est exactement ce que ferait un filtre appliqué à
    // une liste vide.
    const fields = [field('q1', 's1'), field('q2', 's2')];
    const visible = evaluateFormVisibility({ fields }, {});
    expect(visible.fields.size).toBe(2);
  });
});

describe('evaluateFormVisibility — point fixe', () => {
  const sections = [section('s1', 0)];

  it('referme une chaîne quand son premier maillon se referme', () => {
    // Q1 ouvre Q2, la réponse à Q2 ouvre Q3. Le répondant revient sur Q1 et
    // change d'avis : Q2 disparaît, et sa réponse, restée en mémoire, ne doit
    // plus maintenir Q3 à l'écran.
    const fields = [
      field('q1'),
      field('q2', 's1', { visibility: when('q1', 'oui') }),
      field('q3', 's1', { visibility: when('q2', 'oui') })
    ];

    const both = evaluateFormVisibility({ fields, sections }, { q1: 'oui', q2: 'oui' });
    expect(both.fields.has('q2')).toBe(true);
    expect(both.fields.has('q3')).toBe(true);

    const collapsed = evaluateFormVisibility({ fields, sections }, { q1: 'non', q2: 'oui' });
    expect(collapsed.fields.has('q2')).toBe(false);
    expect(collapsed.fields.has('q3')).toBe(false);
  });

  it('termine sur deux verrous qui s’excluent', () => {
    // A ne s'affiche que si B est vide, B que si A est vide : aucun état stable
    // n'existe. La borne de passes doit garantir la terminaison plutôt que de
    // figer l'onglet du répondant.
    const fields = [
      field('a', 's1', { visibility: { conditions: [{ source_field_id: 'b', operator: 'is_empty', value: '' }], operator: 'AND' } }),
      field('b', 's1', { visibility: { conditions: [{ source_field_id: 'a', operator: 'is_empty', value: '' }], operator: 'AND' } })
    ];

    expect(() => evaluateFormVisibility({ fields, sections }, { a: 'x', b: 'y' })).not.toThrow();
  });
});

describe('evaluateFormVisibility — opérateurs de présence', () => {
  const sections = [section('s1', 0)];

  it('distingue « renseigné » de « vide »', () => {
    const fields = [
      field('q1'),
      field('q2', 's1', {
        visibility: {
          conditions: [{ source_field_id: 'q1', operator: 'is_filled', value: '' }],
          operator: 'AND'
        }
      })
    ];

    expect(evaluateFormVisibility({ fields, sections }, {}).fields.has('q2')).toBe(false);
    expect(evaluateFormVisibility({ fields, sections }, { q1: '   ' }).fields.has('q2')).toBe(false);
    expect(evaluateFormVisibility({ fields, sections }, { q1: 'a' }).fields.has('q2')).toBe(true);
  });

  it('tient la réponse zéro pour une réponse', () => {
    // Sur une échelle qui commence à zéro, le répondant le plus critique répond
    // bel et bien : un test de présence ne doit pas le déclarer muet.
    const fields = [
      field('note', 's1', { type: 'nps' }),
      field('suite', 's1', {
        visibility: {
          conditions: [{ source_field_id: 'note', operator: 'is_filled', value: '' }],
          operator: 'AND'
        }
      })
    ];

    expect(evaluateFormVisibility({ fields, sections }, { note: 0 }).fields.has('suite')).toBe(true);
  });
});
