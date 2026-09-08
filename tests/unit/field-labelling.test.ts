import { describe, expect, it } from 'vitest';

import {
  controlAttrsFor,
  fieldControlId,
  fieldDescriptionId,
  fieldLabelId,
  isGroupedField,
  isSilentField,
  labelsSingleControl
} from '@/lib/field-labelling';
import type { Field, FieldType } from '@/types';

/**
 * Le rattachement d'un intitulé à son contrôle.
 *
 * Ce module décide, pour chaque type de champ, si la question peut être un
 * `<label for>` ou doit devenir un groupe nommé. Se tromper ne casse aucun
 * écran : la page s'affiche à l'identique, et seul un lecteur d'écran s'aperçoit
 * qu'un champ n'a pas de nom — ou qu'un intitulé de question est devenu le nom
 * de sa première option. D'où des tests par type plutôt qu'un test global.
 */

function field(type: FieldType, description?: string): Field {
  return {
    id: 'f1',
    type,
    label: { fr: 'Question' },
    description: description ? { fr: description } : { fr: '' }
  } as Field;
}

describe('classement des types', () => {
  it('les saisies ont un contrôle unique, donc un vrai libellé', () => {
    const single: FieldType[] = [
      'short_text',
      'long_text',
      'email',
      'url',
      'number',
      'date',
      'dropdown',
      'currency',
      'address',
      'country',
      'calculated'
    ];

    for (const type of single) {
      expect(labelsSingleControl(type), type).toBe(true);
      expect(isGroupedField(type), type).toBe(false);
    }
  });

  it('les questions à plusieurs contrôles deviennent des groupes', () => {
    const grouped: FieldType[] = [
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
    ];

    for (const type of grouped) {
      expect(isGroupedField(type), type).toBe(true);
      // Un `<label for>` désignerait arbitrairement le premier contrôle.
      expect(labelsSingleControl(type), type).toBe(false);
    }
  });

  it('les éléments de mise en page ne posent aucune question', () => {
    for (const type of ['statement', 'divider', 'link', 'hidden'] as FieldType[]) {
      expect(isSilentField(type), type).toBe(true);
      expect(labelsSingleControl(type), type).toBe(false);
      // Ni libellé ni groupe : envelopper un filet de séparation dans un
      // `role="group"` annoncerait un ensemble vide.
      expect(isGroupedField(type), type).toBe(false);
    }
  });
});

describe('identifiants', () => {
  it('les trois identifiants d’un champ sont distincts et stables', () => {
    expect(fieldLabelId('abc')).toBe('q-abc-label');
    expect(fieldControlId('abc')).toBe('q-abc-control');
    expect(fieldDescriptionId('abc')).toBe('q-abc-desc');

    const ids = [fieldLabelId('abc'), fieldControlId('abc'), fieldDescriptionId('abc')];
    expect(new Set(ids).size).toBe(3);
  });

  it('deux champs ne partagent jamais un identifiant', () => {
    expect(fieldControlId('a')).not.toBe(fieldControlId('b'));
  });
});

describe('attributs du contrôle', () => {
  it('un champ à contrôle unique reçoit son identifiant et son nom', () => {
    expect(controlAttrsFor(field('short_text'))).toEqual({
      id: 'q-f1-control',
      'aria-labelledby': 'q-f1-label'
    });
  });

  it('la description est rattachée quand elle existe', () => {
    expect(controlAttrsFor(field('email', 'Nous ne la publions pas.'))).toEqual({
      id: 'q-f1-control',
      'aria-labelledby': 'q-f1-label',
      'aria-describedby': 'q-f1-desc'
    });
  });

  it('une description vide ne produit pas de renvoi vers du vide', () => {
    // `aria-describedby` pointant vers un élément absent fait annoncer un nom
    // tronqué sur certains lecteurs — pire que pas de description du tout.
    expect(controlAttrsFor(field('number'))['aria-describedby']).toBeUndefined();
  });

  it('une question à plusieurs contrôles ne reçoit rien : le groupe la nomme', () => {
    expect(controlAttrsFor(field('single_choice', 'Un seul choix.'))).toEqual({});
    expect(controlAttrsFor(field('rating'))).toEqual({});
  });

  it('un élément de mise en page ne reçoit rien non plus', () => {
    expect(controlAttrsFor(field('divider'))).toEqual({});
    expect(controlAttrsFor(field('statement', 'Texte informatif.'))).toEqual({});
  });
});
