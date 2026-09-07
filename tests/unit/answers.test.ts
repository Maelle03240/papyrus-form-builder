import { describe, it, expect } from 'vitest';
import { applyCalculatedFields, calcFieldValue, calcSourceCandidates } from '@/lib/calculated';
import { canBeRequired, formatAnswer, isAnswerable, isAnswerEmpty } from '@/lib/submission-format';
import type { Field, FieldType } from '@/types';

function field(id: string, type: FieldType, extra: Partial<Field> = {}): Field {
  return {
    id,
    form_id: 'form-1',
    section_id: 's1',
    type,
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

describe('isAnswerEmpty', () => {
  it('tient zéro et faux pour des réponses', () => {
    expect(isAnswerEmpty(0)).toBe(false);
    expect(isAnswerEmpty(false)).toBe(false);
  });

  it('déclare vide un bloc répétable dont aucune ligne n’est remplie', () => {
    // Un bloc garde toujours une ligne à l'écran : sans cette règle, un bloc
    // obligatoire serait tenu pour rempli par sa seule ligne d'accueil, et
    // l'envoi passerait sans un seul participant.
    expect(isAnswerEmpty([{}])).toBe(true);
    expect(isAnswerEmpty([{ nom: '' }, { nom: '   ' }])).toBe(true);
  });

  it('déclare rempli un bloc dès qu’une seule cellule porte une valeur', () => {
    expect(isAnswerEmpty([{ nom: '' }, { nom: 'Livinia' }])).toBe(false);
  });

  it('ne casse pas les réponses à choix multiple', () => {
    expect(isAnswerEmpty([])).toBe(true);
    expect(isAnswerEmpty(['opt-1'])).toBe(false);
  });
});

describe('isAnswerable / canBeRequired', () => {
  it('exclut les champs de mise en page des réponses', () => {
    for (const type of ['statement', 'image', 'video', 'divider', 'link'] as FieldType[]) {
      expect(isAnswerable(field('x', type))).toBe(false);
    }
  });

  it('garde une réponse pour les champs caché et calculé', () => {
    // Leur valeur n'est pas saisie, mais elle est bel et bien enregistrée —
    // c'est tout l'intérêt de ces deux champs.
    expect(isAnswerable(field('x', 'hidden'))).toBe(true);
    expect(isAnswerable(field('x', 'calculated'))).toBe(true);
  });

  it('n’exige jamais ce que le répondant ne saisit pas', () => {
    expect(canBeRequired(field('x', 'hidden'))).toBe(false);
    expect(canBeRequired(field('x', 'calculated'))).toBe(false);
    expect(canBeRequired(field('x', 'short_text'))).toBe(true);
  });
});

describe('formatAnswer — types de la phase 2', () => {
  it('rend un oui/non avec ses libellés', () => {
    const question = field('q', 'yesno', {
      validation: { yes_label: "J'accepte", no_label: 'Je refuse' }
    });
    expect(formatAnswer(question, 'yes')).toBe("J'accepte");
    expect(formatAnswer(question, 'no')).toBe('Je refuse');
  });

  it('rend un pays par son nom, pas son code', () => {
    expect(formatAnswer(field('q', 'country'), 'MU')).toBe('Maurice');
  });

  it('rend un montant avec sa devise', () => {
    expect(formatAnswer(field('q', 'currency'), '1500')).toBe('MUR 1500');
    expect(
      formatAnswer(
        field('q', 'currency', { validation: { currency_code: 'EUR', currency_position: 'after' } }),
        '20'
      )
    ).toBe('20 EUR');
  });

  it('rend un bloc répétable lisible dans une cellule de tableur', () => {
    // `Array.join` produirait « [object Object] », et `JSON.stringify` du bruit
    // illisible : ces deux-là finiraient tels quels dans l'export et la feuille
    // Google.
    const question = field('q', 'repeater', {
      repeater: {
        min: 1,
        max: 3,
        item_label: { fr: 'Participant' },
        fields: [
          {
            id: 'nom',
            type: 'short_text',
            label: { fr: 'Nom' },
            description: { fr: '' },
            placeholder: { fr: '' },
            options: [],
            required: false,
            validation: {}
          }
        ]
      }
    });

    expect(formatAnswer(question, [{ nom: 'Livinia' }, { nom: 'Keven' }])).toBe(
      'Participant 1 — Nom : Livinia | Participant 2 — Nom : Keven'
    );
  });

  it('n’écrit rien pour un bloc entièrement vide', () => {
    const question = field('q', 'repeater');
    expect(formatAnswer(question, [{}], '—')).toBe('—');
  });
});

describe('calcFieldValue', () => {
  const counting = (sources: string[], offset = 0) =>
    field('total', 'calculated', { calc: { mode: 'count', sources, offset } });

  it('compte les lignes des blocs cités', () => {
    expect(
      calcFieldValue(counting(['bloc']), { bloc: [{ n: 'a' }, { n: 'b' }, { n: 'c' }] })
    ).toBe(3);
  });

  it('ne compte pas les lignes restées vides', () => {
    // Un bloc affiche toujours une ligne d'accueil, et « Ajouter » en pose une
    // vierge. Les compter ferait annoncer un participant à un formulaire auquel
    // personne ne s'est encore inscrit.
    expect(calcFieldValue(counting(['bloc']), { bloc: [{}] })).toBe(0);
    expect(calcFieldValue(counting(['bloc']), { bloc: [{ n: 'a' }, {}] })).toBe(1);
  });

  it('ajoute le décalage', () => {
    // Le cas qui existe : « le nombre de participants, plus l'organisateur ».
    expect(calcFieldValue(counting(['bloc'], 1), { bloc: [{ n: 'a' }, { n: 'b' }] })).toBe(3);
  });

  it('ne descend jamais sous zéro en comptage', () => {
    expect(calcFieldValue(counting(['bloc'], -2), { bloc: [{ n: 'a' }] })).toBe(0);
  });

  it('additionne des montants, virgule décimale comprise', () => {
    const total = field('total', 'calculated', {
      calc: { mode: 'sum', sources: ['a', 'b'], offset: 0 }
    });
    expect(calcFieldValue(total, { a: '12,50', b: 7.5 })).toBe(20);
  });

  it('laisse une somme devenir négative', () => {
    // Une remise est une somme négative légitime — contrairement à un décompte.
    const total = field('total', 'calculated', {
      calc: { mode: 'sum', sources: ['a'], offset: -50 }
    });
    expect(calcFieldValue(total, { a: '10' })).toBe(-40);
  });

  it('vaut zéro sans configuration', () => {
    expect(calcFieldValue(field('total', 'calculated'), { bloc: [{}, {}] })).toBe(0);
  });
});

describe('applyCalculatedFields', () => {
  it('enchaîne les totaux dans l’ordre de lecture', () => {
    const fields = [
      field('bloc', 'repeater', { field_order: 0 }),
      field('n', 'calculated', {
        field_order: 1,
        calc: { mode: 'count', sources: ['bloc'], offset: 1 }
      }),
      field('prix', 'calculated', {
        field_order: 2,
        calc: { mode: 'sum', sources: ['n'], offset: 0 }
      })
    ];

    const out = applyCalculatedFields(fields, { bloc: [{ n: 'a' }, { n: 'b' }] });
    expect(out.n).toBe(3);
    expect(out.prix).toBe(3);
  });

  it('remplace la valeur annoncée par le client', () => {
    // Elle arrive bien dans la requête, puisque le répondant la voit à l'écran.
    // Rien n'empêche de la remplacer avant l'envoi.
    const fields = [
      field('bloc', 'repeater'),
      field('n', 'calculated', { calc: { mode: 'count', sources: ['bloc'], offset: 0 } })
    ];

    expect(
      applyCalculatedFields(fields, { bloc: [{ n: 'a' }, { n: 'b' }, { n: 'c' }], n: 1 }).n
    ).toBe(3);
  });
});

describe('calcSourceCandidates', () => {
  it('ne propose que des blocs répétables pour un comptage', () => {
    const fields = [field('a', 'repeater'), field('b', 'number'), field('c', 'short_text')];
    expect(calcSourceCandidates(fields, 'count').map((f) => f.id)).toEqual(['a']);
  });

  it('ne propose que du numérique pour une somme', () => {
    const fields = [
      field('a', 'repeater'),
      field('b', 'number'),
      field('c', 'currency'),
      field('d', 'short_text')
    ];
    expect(calcSourceCandidates(fields, 'sum').map((f) => f.id)).toEqual(['b', 'c']);
  });
});
