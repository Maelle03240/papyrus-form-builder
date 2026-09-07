import { describe, it, expect } from 'vitest';
import {
  computeLines,
  computeTotals,
  discountStatus,
  formatMoney,
  hasPricedFields,
  optionQuantity,
  quantityKey,
  registrationUnits,
  resolvePricing,
  resolveTier
} from '@/lib/pricing';
import { DISCOUNT_CODE_KEY } from '@/types';
import type {
  Field,
  FieldOption,
  PricingConfig,
  ProjectPricing,
  Section,
  TieredPricing
} from '@/types';

/**
 * Ces tests portent sur de l'argent : ce qu'ils fixent finit sur une facture.
 *
 * Trois propriétés comptent plus que le reste, et chacune a sa section :
 * on ne facture que ce qui est à l'écran ; les centimes ne dérivent pas ; et le
 * détail figé suffit à réexpliquer le montant des mois plus tard.
 */

function section(id: string, order = 0, extra: Partial<Section> = {}): Section {
  return {
    id,
    form_id: 'form-1',
    title: { fr: '' },
    description: { fr: '' },
    section_order: order,
    ...extra
  };
}

function option(id: string, label: string, price?: number): FieldOption {
  return { id, label: { fr: label }, ...(price === undefined ? {} : { price }) };
}

function field(id: string, type: Field['type'], extra: Partial<Field> = {}): Field {
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

const PRICING: PricingConfig & ProjectPricing = {
  enabled: true,
  currency: 'MUR',
  currency_position: 'before',
  vat_enabled: false,
  vat_rate: 15
};

describe('resolvePricing', () => {
  it('hérite la devise du projet', () => {
    const resolved = resolvePricing({
      pricing_config: { enabled: true },
      project_pricing: {
        currency: 'EUR',
        currency_position: 'after',
        vat_enabled: true,
        vat_rate: 20
      }
    });

    expect(resolved.currency).toBe('EUR');
    expect(resolved.currency_position).toBe('after');
    expect(resolved.vat_enabled).toBe(true);
    expect(resolved.vat_rate).toBe(20);
  });

  it('laisse le formulaire surcharger le projet', () => {
    const resolved = resolvePricing({
      pricing_config: { enabled: true, currency: 'USD', vat_enabled: false },
      project_pricing: {
        currency: 'EUR',
        currency_position: 'after',
        vat_enabled: true,
        vat_rate: 20
      }
    });

    expect(resolved.currency).toBe('USD');
    // La position n'est pas surchargée : elle reste celle du projet.
    expect(resolved.currency_position).toBe('after');
    expect(resolved.vat_enabled).toBe(false);
  });

  it('retombe sur les valeurs par défaut sans projet', () => {
    const resolved = resolvePricing({ pricing_config: { enabled: true } });
    expect(resolved.currency).toBe('MUR');
    expect(resolved.vat_enabled).toBe(false);
  });

  it('tient un formulaire sans configuration pour non tarifé', () => {
    expect(resolvePricing({}).enabled).toBe(false);
  });
});

describe('computeLines — on ne facture que ce qui est à l’écran', () => {
  const sections = [section('s1', 0), section('s2', 1)];

  it('additionne les options retenues', () => {
    const fields = [
      field('q1', 'multiple_choice', {
        options: [option('o1', 'Dîner', 1500), option('o2', 'Atelier', 500)]
      })
    ];

    const lines = computeLines({ fields, sections }, { q1: ['o1', 'o2'] });
    expect(lines.map((line) => line.amount)).toEqual([1500, 500]);
  });

  it('ignore une option sans prix', () => {
    const fields = [
      field('q1', 'single_choice', { options: [option('o1', 'Gratuit'), option('o2', 'Payant', 100)] })
    ];
    expect(computeLines({ fields, sections }, { q1: 'o1' })).toEqual([]);
  });

  it('ne facture pas une option masquée par un verrou', () => {
    // Le cas qui coûte cher : le répondant coche, change de branche, et l'option
    // disparaît de l'écran. La facturer quand même est une facture contestée.
    const fields = [
      field('gate', 'yesno'),
      field('q1', 'single_choice', {
        options: [option('o1', 'Dîner', 1500)],
        visibility: {
          conditions: [{ source_field_id: 'gate', operator: 'equals', value: 'yes' }],
          operator: 'AND'
        }
      })
    ];

    expect(computeLines({ fields, sections }, { gate: 'yes', q1: 'o1' })).toHaveLength(1);
    expect(computeLines({ fields, sections }, { gate: 'no', q1: 'o1' })).toEqual([]);
  });

  it('ne facture pas une option d’une section masquée', () => {
    const hidden = [section('s1', 0), section('s2', 1, { hidden: true })];
    const fields = [
      field('q1', 'single_choice', {
        section_id: 's2',
        options: [option('o1', 'Dîner', 1500)]
      })
    ];
    expect(computeLines({ fields, sections: hidden }, { q1: 'o1' })).toEqual([]);
  });

  it('multiplie par la quantité', () => {
    const fields = [
      field('q1', 'single_choice', {
        options: [option('o1', 'Table de 6', 3000)],
        pricing: { quantity: { enabled: true, min: 1, max: 10 } }
      })
    ];

    const lines = computeLines(
      { fields, sections },
      { q1: 'o1', [quantityKey('q1')]: { o1: 3 } }
    );

    expect(lines[0].quantity).toBe(3);
    expect(lines[0].amount).toBe(9000);
  });

  it('compte le montant saisi quand le champ le demande', () => {
    const fields = [
      field('don', 'currency', { pricing: { count_in_total: true } }),
      field('autre', 'currency')
    ];

    const lines = computeLines({ fields, sections }, { don: '250,50', autre: '999' });
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(250.5);
  });

  it('facture chaque ligne d’un bloc répétable', () => {
    // C'est ainsi qu'on facture un tarif par participant : chacun choisit son
    // option dans sa propre ligne.
    const fields = [
      field('participants', 'repeater', {
        repeater: {
          min: 1,
          max: 5,
          item_label: { fr: 'Participant' },
          fields: [
            {
              id: 'menu',
              type: 'single_choice',
              label: { fr: 'Menu' },
              description: { fr: '' },
              placeholder: { fr: '' },
              options: [option('viande', 'Viande', 800), option('veg', 'Végétarien', 700)],
              required: false,
              validation: {}
            }
          ]
        }
      })
    ];

    const lines = computeLines(
      { fields, sections },
      { participants: [{ menu: 'viande' }, { menu: 'veg' }] }
    );

    expect(lines.map((line) => line.amount)).toEqual([800, 700]);
    expect(lines[0].label).toBe('Participant 1 — Menu');
  });
});

describe('computeTotals — les centimes ne dérivent pas', () => {
  const sections = [section('s1')];

  it('n’accumule pas d’erreur de virgule flottante', () => {
    // 0,1 + 0,2 vaut 0,30000000000000004 en flottant. Répété sur assez de
    // lignes, l'écart s'imprime sur la facture.
    const fields = [
      field('q1', 'multiple_choice', {
        options: [option('a', 'A', 0.1), option('b', 'B', 0.2), option('c', 'C', 0.1)]
      })
    ];

    const totals = computeTotals({ fields, sections }, { q1: ['a', 'b', 'c'] }, PRICING);
    expect(totals.subtotal).toBe(0.4);
    expect(totals.total).toBe(0.4);
  });

  it('applique la TVA sur le net, après remise', () => {
    const fields = [field('q1', 'single_choice', { options: [option('o1', 'Place', 1000)] })];
    const pricing: PricingConfig & ProjectPricing = {
      ...PRICING,
      vat_enabled: true,
      vat_rate: 15,
      discount_enabled: true,
      discounts: [{ id: 'd1', code: 'EARLY20', percent: 20 }]
    };

    const totals = computeTotals(
      { fields, sections },
      { q1: 'o1', [DISCOUNT_CODE_KEY]: 'early20' },
      pricing
    );

    expect(totals.subtotal).toBe(1000);
    expect(totals.discount).toBe(200);
    expect(totals.vat).toBe(120); // 15 % de 800, pas de 1000
    expect(totals.total).toBe(920);
  });

  it('ignore un code inconnu', () => {
    const fields = [field('q1', 'single_choice', { options: [option('o1', 'Place', 1000)] })];
    const pricing: PricingConfig & ProjectPricing = {
      ...PRICING,
      discount_enabled: true,
      discounts: [{ id: 'd1', code: 'EARLY20', percent: 20 }]
    };

    const totals = computeTotals(
      { fields, sections },
      { q1: 'o1', [DISCOUNT_CODE_KEY]: 'NIMPORTEQUOI' },
      pricing
    );

    expect(totals.discount).toBe(0);
    expect(totals.discount_code).toBe('');
  });

  it('n’applique aucun code quand les remises sont désactivées', () => {
    const fields = [field('q1', 'single_choice', { options: [option('o1', 'Place', 1000)] })];
    const totals = computeTotals(
      { fields, sections },
      { q1: 'o1', [DISCOUNT_CODE_KEY]: 'EARLY20' },
      { ...PRICING, discount_enabled: false, discounts: [{ id: 'd1', code: 'EARLY20', percent: 20 }] }
    );
    expect(totals.discount).toBe(0);
  });

  it('ne descend jamais sous zéro', () => {
    const fields = [field('q1', 'single_choice', { options: [option('o1', 'Place', 100)] })];
    const totals = computeTotals(
      { fields, sections },
      { q1: 'o1', [DISCOUNT_CODE_KEY]: 'TOUT' },
      {
        ...PRICING,
        discount_enabled: true,
        discounts: [{ id: 'd1', code: 'TOUT', percent: 100 }]
      }
    );
    expect(totals.total).toBe(0);
  });
});

describe('computeTotals — l’instantané se suffit à lui-même', () => {
  it('conserve le détail, les libellés et la devise', () => {
    // Une facture rééditée six mois plus tard ne doit dépendre d'aucun état du
    // formulaire, qui aura changé entre-temps.
    const fields = [
      field('q1', 'single_choice', { options: [option('o1', 'Dîner de gala', 1500)] })
    ];
    const totals = computeTotals({ fields, sections: [section('s1')] }, { q1: 'o1' }, {
      ...PRICING,
      vat_enabled: true,
      vat_label: 'TVA 15 %',
      total_label: 'Net à payer'
    });

    expect(totals.lines[0]).toMatchObject({
      label: 'q1',
      detail: 'Dîner de gala',
      quantity: 1,
      unit_price: 1500,
      amount: 1500
    });
    expect(totals.currency).toBe('MUR');
    expect(totals.vat_label).toBe('TVA 15 %');
    expect(totals.total_label).toBe('Net à payer');
  });
});

describe('resolveTier', () => {
  const tiered: TieredPricing = {
    enabled: true,
    count_by: 'submission',
    after_last: 'keep',
    tiers: [
      { up_to: 50, price: 1000, label: 'Early bird' },
      { up_to: 100, price: 1500, label: 'Normal' },
      { up_to: null, price: 2000, label: 'Dernière minute' }
    ]
  };

  it('applique le palier courant', () => {
    expect(resolveTier(tiered, 0).price).toBe(1000);
    expect(resolveTier(tiered, 49).price).toBe(1000);
    expect(resolveTier(tiered, 50).price).toBe(1500);
    expect(resolveTier(tiered, 150).price).toBe(2000);
  });

  it('annonce les places restantes avant le seuil suivant', () => {
    const info = resolveTier(tiered, 42);
    expect(info.remaining).toBe(8);
    expect(info.next_price).toBe(1500);
  });

  it('ferme les inscriptions quand l’auteur le demande', () => {
    const closing: TieredPricing = {
      ...tiered,
      after_last: 'close',
      tiers: [{ up_to: 50, price: 1000 }]
    };

    expect(resolveTier(closing, 49).closed).toBe(false);
    expect(resolveTier(closing, 50).closed).toBe(true);
  });

  it('garde le dernier tarif sinon', () => {
    const keeping: TieredPricing = { ...tiered, tiers: [{ up_to: 50, price: 1000 }] };
    expect(resolveTier(keeping, 500).closed).toBe(false);
    expect(resolveTier(keeping, 500).price).toBe(1000);
  });

  it('ne casse pas sans palier', () => {
    expect(resolveTier({ ...tiered, tiers: [] }, 10).price).toBe(0);
  });
});

describe('registrationUnits', () => {
  const base: TieredPricing = {
    enabled: true,
    count_by: 'submission',
    after_last: 'keep',
    tiers: []
  };

  it('compte une réponse par défaut', () => {
    expect(registrationUnits(base, {})).toBe(1);
  });

  it('compte les lignes du bloc désigné', () => {
    // Un car de trente personnes n'est pas une inscription.
    const perParticipant: TieredPricing = {
      ...base,
      count_by: 'participant',
      participant_field_id: 'bloc'
    };
    expect(registrationUnits(perParticipant, { bloc: [{}, {}, {}] })).toBe(3);
    expect(registrationUnits(perParticipant, {})).toBe(0);
  });
});

describe('computeTotals — tarif dégressif', () => {
  it('ajoute la ligne d’inscription au bon palier', () => {
    const pricing: PricingConfig & ProjectPricing = {
      ...PRICING,
      tiered: {
        enabled: true,
        count_by: 'submission',
        after_last: 'keep',
        registration_label: 'Inscription',
        tiers: [
          { up_to: 50, price: 1000, label: 'Early bird' },
          { up_to: null, price: 1500, label: 'Plein tarif' }
        ]
      }
    };

    const early = computeTotals({ fields: [], sections: [section('s1')] }, {}, pricing, 10);
    expect(early.registration?.amount).toBe(1000);
    expect(early.registration?.tier_label).toBe('Early bird');
    expect(early.total).toBe(1000);

    const late = computeTotals({ fields: [], sections: [section('s1')] }, {}, pricing, 80);
    expect(late.registration?.amount).toBe(1500);
  });
});

describe('optionQuantity', () => {
  const counted = field('q1', 'single_choice', {
    options: [option('o1', 'Table', 100)],
    pricing: { quantity: { enabled: true, min: 2, max: 5 } }
  });

  it('vaut un sans compteur', () => {
    expect(optionQuantity(field('q1', 'single_choice'), {}, 'o1')).toBe(1);
  });

  it('retombe sur le minimum sans valeur enregistrée', () => {
    expect(optionQuantity(counted, {}, 'o1')).toBe(2);
  });

  it('borne la quantité aux limites du champ', () => {
    expect(optionQuantity(counted, { [quantityKey('q1')]: { o1: 99 } }, 'o1')).toBe(5);
    expect(optionQuantity(counted, { [quantityKey('q1')]: { o1: 1 } }, 'o1')).toBe(2);
  });
});

describe('hasPricedFields', () => {
  it('repère un prix posé sur une option', () => {
    expect(
      hasPricedFields([field('q1', 'single_choice', { options: [option('o1', 'A', 10)] })])
    ).toBe(true);
  });

  it('repère un montant qui compte dans le total', () => {
    expect(hasPricedFields([field('q1', 'number', { pricing: { count_in_total: true } })])).toBe(
      true
    );
  });

  it('regarde aussi dans les blocs répétables', () => {
    const repeater = field('bloc', 'repeater', {
      repeater: {
        min: 1,
        max: 3,
        item_label: { fr: 'Ligne' },
        fields: [
          {
            id: 'menu',
            type: 'single_choice',
            label: { fr: 'Menu' },
            description: { fr: '' },
            placeholder: { fr: '' },
            options: [option('a', 'A', 500)],
            required: false,
            validation: {}
          }
        ]
      }
    });
    expect(hasPricedFields([repeater])).toBe(true);
  });

  it('renvoie faux sur un formulaire sans prix', () => {
    expect(hasPricedFields([field('q1', 'short_text')])).toBe(false);
  });
});

describe('discountStatus', () => {
  const config: PricingConfig = {
    enabled: true,
    discounts: [{ id: 'd1', code: 'EARLY20', percent: 20 }]
  };

  it('reconnaît un code sans tenir compte de la casse ni des espaces', () => {
    expect(discountStatus(config, ' early20 ')).toBe('valid');
  });

  it('distingue le vide de l’invalide', () => {
    expect(discountStatus(config, '')).toBe('none');
    expect(discountStatus(config, 'ZZZ')).toBe('invalid');
  });
});

describe('formatMoney', () => {
  it('place la devise du bon côté', () => {
    expect(formatMoney(1500, 'MUR', 'before')).toContain('MUR');
    expect(formatMoney(1500, 'MUR', 'after').endsWith('MUR')).toBe(true);
  });

  it('affiche toujours deux décimales', () => {
    expect(formatMoney(1500, 'MUR', 'after')).toMatch(/1\s?500,00 MUR/);
  });
});
