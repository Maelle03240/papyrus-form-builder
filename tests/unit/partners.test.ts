import { describe, it, expect } from 'vitest';

import {
  attributedFormPath,
  buildLedger,
  canSettle,
  commissionOn,
  commissionPercent,
  emptyLedger,
  generatePartnerCode,
  isValidPartnerCode,
  joinPath,
  landingCta,
  landingHeading,
  landingPartnerLabel,
  landingPath,
  partnerConfigOf,
  portalPath,
  slugifyPartner,
  stageOf
} from '@/lib/partners';
import { extractContact } from '@/lib/contacts';
import type { Field, Form, PartnerRegistration, SubmissionStatus, TotalsSnapshot } from '@/types';

/**
 * Ce que fixent ces tests, c'est de l'argent qu'on verse à quelqu'un.
 *
 * Deux propriétés comptent plus que le reste, et les deux tiennent le registre
 * debout : `earned` est TOUJOURS la somme de `toPay` et `received` (sans quoi
 * l'écran additionne deux fois le même argent), et une réponse annulée ne
 * rapporte rien (sans quoi annuler une inscription laisse une dette derrière
 * elle).
 */

function totals(total: number, currency = 'MUR'): TotalsSnapshot {
  return {
    currency,
    currency_position: 'before',
    lines: [],
    subtotal: total,
    discount: 0,
    discount_percent: 0,
    discount_code: '',
    vat: 0,
    vat_rate: 0,
    total,
    subtotal_label: 'Sous-total',
    discount_label: 'Remise',
    vat_label: 'TVA',
    total_label: 'Total'
  };
}

function registration(
  overrides: Partial<PartnerRegistration> & { status: SubmissionStatus; total?: number }
): PartnerRegistration {
  const { total = 1000, ...rest } = overrides;
  return {
    id: 'sub-1',
    project_partner_id: 'link-1',
    partner_id: 'partner-1',
    project_id: 'project-1',
    completed_at: '2026-09-08T10:00:00.000Z',
    respondent_email: 'client@exemple.mu',
    respondent_language: 'fr',
    invoice_number: null,
    pricing: totals(total),
    commission_paid_at: null,
    commission_paid_by: '',
    commission_percent: 10,
    ...rest
  };
}

// ============================================================================
// Le montant d'une commission
// ============================================================================

describe('commissionOn', () => {
  it('applique le taux au total figé de la réponse', () => {
    expect(commissionOn(totals(3450), 'paid', 10)).toBe(345);
  });

  it('ne rapporte rien sur une réponse annulée', () => {
    // La règle de la phase 5 continue ici : une inscription annulée libère sa
    // place, et ne doit donc pas non plus laisser une commission à verser.
    expect(commissionOn(totals(3450), 'void', 10)).toBe(0);
  });

  it('ne rapporte rien sans instantané de prix', () => {
    // Un sondage sans tarification : le partenaire a amené quelqu'un, mais il
    // n'y a aucun montant sur lequel calculer quoi que ce soit.
    expect(commissionOn(null, 'paid', 10)).toBe(0);
    expect(commissionOn(undefined, 'paid', 10)).toBe(0);
  });

  it('ne rapporte rien à taux nul', () => {
    expect(commissionOn(totals(3450), 'paid', 0)).toBe(0);
  });

  it('arrondit au centime', () => {
    // 12,5 % de 333,33 vaut 41,66625 : sans arrondi ici, le total du registre
    // ne correspondrait à aucune somme des lignes affichées.
    expect(commissionOn(totals(333.33), 'paid', 12.5)).toBe(41.67);
  });

  it('reste dû sur une réponse encore impayée — mais pas encore acquis', () => {
    // Le montant existe dès l'inscription ; c'est le registre, et non ce
    // calcul, qui décide dans quelle colonne il tombe.
    expect(commissionOn(totals(1000), 'submitted', 10)).toBe(100);
  });
});

describe('commissionPercent', () => {
  it('borne un taux aberrant à 100 %', () => {
    // Une faute de frappe — « 1000 » pour « 10,00 » — ne doit pas produire une
    // commission dix fois supérieure au prix de l'inscription.
    expect(commissionPercent({ commission_percent: 1000 })).toBe(100);
  });

  it('ramène l’absence de réglage et les valeurs négatives à zéro', () => {
    expect(commissionPercent({})).toBe(0);
    expect(commissionPercent(undefined)).toBe(0);
    expect(commissionPercent({ commission_percent: -5 })).toBe(0);
  });
});

// ============================================================================
// Les trois étapes
// ============================================================================

describe('stageOf', () => {
  it('attend le paiement du client tant que la réponse n’est pas encaissée', () => {
    expect(stageOf({ status: 'submitted', commission_paid_at: null })).toBe('awaiting_client');
    expect(stageOf({ status: 'reviewed', commission_paid_at: null })).toBe('awaiting_client');
  });

  it('devient dû dès que la réponse est encaissée', () => {
    expect(stageOf({ status: 'paid', commission_paid_at: null })).toBe('to_pay');
  });

  it('est versée dès qu’un horodatage existe', () => {
    expect(stageOf({ status: 'paid', commission_paid_at: '2026-09-08T00:00:00Z' })).toBe('received');
  });
});

describe('canSettle', () => {
  it('refuse de verser une commission sur une inscription impayée', () => {
    // C'est le garde-fou du portail ET de la route : le partenaire ne peut pas
    // confirmer avoir reçu un argent que le client n'a pas encore versé.
    expect(canSettle({ status: 'submitted', commission_paid_at: null })).toBe(false);
    expect(canSettle({ status: 'void', commission_paid_at: null })).toBe(false);
  });

  it('refuse de verser deux fois', () => {
    expect(canSettle({ status: 'paid', commission_paid_at: '2026-09-08T00:00:00Z' })).toBe(false);
  });

  it('accepte une commission acquise et non versée', () => {
    expect(canSettle({ status: 'paid', commission_paid_at: null })).toBe(true);
  });
});

// ============================================================================
// Le registre
// ============================================================================

describe('buildLedger', () => {
  const rows: PartnerRegistration[] = [
    registration({ id: 'a', status: 'submitted', total: 1000 }),
    registration({ id: 'b', status: 'paid', total: 2000 }),
    registration({
      id: 'c',
      status: 'paid',
      total: 3000,
      commission_paid_at: '2026-09-01T00:00:00Z',
      commission_paid_by: 'staff'
    }),
    registration({ id: 'd', status: 'void', total: 5000 })
  ];

  it('répartit chaque ligne dans une seule étape', () => {
    const ledger = buildLedger(rows);

    expect(ledger.awaitingClient).toBe(100); // 10 % de 1000
    expect(ledger.toPay).toBe(200); // 10 % de 2000
    expect(ledger.received).toBe(300); // 10 % de 3000
  });

  it('tient l’identité « acquis = à verser + versé »', () => {
    const ledger = buildLedger(rows);

    // La propriété qui empêche l'écran d'additionner deux fois le même argent.
    expect(ledger.earned).toBe(ledger.toPay + ledger.received);
  });

  it('exclut les réponses annulées de toutes les colonnes', () => {
    const ledger = buildLedger(rows);
    const withoutVoid = buildLedger(rows.filter((row) => row.status !== 'void'));

    expect(ledger).toEqual(withoutVoid);
  });

  it('compte les lignes encore dues, pour pouvoir les nommer', () => {
    expect(buildLedger(rows).outstandingCount).toBe(1);
  });

  it('reprend la devise des instantanés plutôt qu’un défaut', () => {
    const ledger = buildLedger([registration({ id: 'e', status: 'paid', pricing: totals(500, 'EUR') })]);
    expect(ledger.currency).toBe('EUR');
  });

  it('rend un registre vide sans aucune ligne', () => {
    expect(buildLedger([])).toEqual(emptyLedger());
  });

  it('ignore les lignes sans montant plutôt que de compter zéro', () => {
    const ledger = buildLedger([registration({ id: 'f', status: 'paid', pricing: null })]);
    expect(ledger.outstandingCount).toBe(0);
  });
});

// ============================================================================
// Les codes et les liens
// ============================================================================

describe('generatePartnerCode', () => {
  it('reprend le nom du partenaire, suivi d’un suffixe', () => {
    const code = generatePartnerCode('Voyages Océan Indien', () => 0);
    expect(code.startsWith('voyages-ocean-indien-')).toBe(true);
  });

  it('n’emploie jamais de caractère ambigu', () => {
    // Un code se lit au téléphone : « l », « 1 », « o » et « 0 » s'y confondent,
    // et le visiteur qui se trompe tombe sur une 404 sans comprendre pourquoi.
    const suffixes = Array.from({ length: 200 }, () =>
      generatePartnerCode('X', Math.random).split('-').pop() ?? ''
    ).join('');

    expect(suffixes).not.toMatch(/[ilo01]/);
  });

  it('produit un code accepté par le contrôle de forme', () => {
    for (const name of ['Acme', 'École du Nord', '   ', '???', 'A'.repeat(80)]) {
      expect(isValidPartnerCode(generatePartnerCode(name))).toBe(true);
    }
  });

  it('donne un code utilisable même sans nom exploitable', () => {
    expect(slugifyPartner('???')).toBe('partenaire');
    expect(slugifyPartner('')).toBe('partenaire');
  });

  it('ne laisse jamais un tiret en fin de partie lisible', () => {
    // La troncature à 24 caractères peut tomber au milieu d'un mot : « acme- »
    // suivi du séparateur donnerait « acme--h4kp ».
    const code = generatePartnerCode('Association des professionnels du tourisme');
    expect(code).not.toMatch(/--/);
  });
});

describe('isValidPartnerCode', () => {
  it('refuse ce qui n’est pas un code', () => {
    // Le code arrive d'une URL publique : il est recopié dans une requête, et
    // seul ce filtre décide de ce qui y entre.
    expect(isValidPartnerCode('../../etc/passwd')).toBe(false);
    expect(isValidPartnerCode('acme%20test')).toBe(false);
    expect(isValidPartnerCode('a')).toBe(false);
    expect(isValidPartnerCode('-acme')).toBe(false);
    expect(isValidPartnerCode('')).toBe(false);
  });
});

describe('les chemins', () => {
  it('mènent là où on croit', () => {
    expect(landingPath('acme-h4kp')).toBe('/a/acme-h4kp');
    expect(portalPath('abcdef')).toBe('/p/abcdef');
    expect(joinPath('token')).toBe('/a/join/token');
  });

  it('portent l’attribution dans l’URL du formulaire', () => {
    expect(attributedFormPath('inscription-2026', 'acme-h4kp')).toBe(
      '/f/inscription-2026?a=acme-h4kp'
    );
  });
});

// ============================================================================
// La page d'accueil
// ============================================================================

describe('les libellés de la page d’accueil', () => {
  it('se rabattent sur le nom du projet et des textes par défaut', () => {
    // Un programme activé sans une ligne de texte doit produire une page juste,
    // pas une page vide.
    const config = partnerConfigOf({ enabled: true });

    expect(landingHeading(config, 'Trail de Rodrigues', 'fr')).toBe('Trail de Rodrigues');
    expect(landingCta(config, 'fr')).toBe('S’inscrire');
    expect(landingCta(config, 'en')).toBe('Register');
    expect(landingPartnerLabel(config, 'fr')).toBe('En partenariat avec');
  });

  it('préfèrent le texte rédigé, dans la langue demandée', () => {
    const config = partnerConfigOf({
      heading: { fr: 'Course du Morne', en: 'Le Morne Race' }
    });

    expect(landingHeading(config, 'Projet', 'en')).toBe('Le Morne Race');
    // Repli sur le français quand la langue demandée n'a pas été traduite.
    expect(landingHeading(config, 'Projet', 'es')).toBe('Course du Morne');
  });

  it('normalisent une configuration absente ou corrompue', () => {
    expect(partnerConfigOf(null).enabled).toBe(false);
    expect(partnerConfigOf('cassé').commission_percent).toBe(0);
    expect(partnerConfigOf([]).self_register).toBe(false);
  });
});

// ============================================================================
// Les contacts
// ============================================================================

function field(id: string, type: Field['type'], label: string): Field {
  return {
    id,
    form_id: 'form-1',
    section_id: 'section-1',
    type,
    label: { fr: label },
    description: { fr: '' },
    placeholder: { fr: '' },
    options: [],
    required: false,
    field_order: 0,
    validation: {}
  } as Field;
}

function form(fields: Field[]): Pick<Form, 'fields'> {
  return { fields };
}

describe('extractContact', () => {
  it('préfère le TYPE du champ à son intitulé', () => {
    // « Adresse e-mail de votre responsable » contient le mot « e-mail » ; le
    // champ typé `email`, lui, est une adresse avec certitude. Prendre le
    // second, c'est éviter d'inscrire le responsable à la place de l'inscrit.
    const result = extractContact(
      form([
        field('f1', 'short_text', 'Adresse e-mail de votre responsable'),
        field('f2', 'email', 'Votre adresse')
      ]),
      { f1: 'chef@exemple.mu', f2: 'inscrit@exemple.mu' }
    );

    expect(result.email).toBe('inscrit@exemple.mu');
  });

  it('recolle prénom et nom quand le formulaire les sépare', () => {
    // Le cas le plus fréquent des bulletins d'inscription. N'en garder qu'un
    // donnerait un carnet d'adresses rempli de prénoms.
    const result = extractContact(
      form([field('f1', 'short_text', 'Prénom'), field('f2', 'short_text', 'Nom de famille')]),
      { f1: 'Livinia', f2: 'Rambert' }
    );

    expect(result.name).toBe('Livinia Rambert');
  });

  it('reconnaît un nom complet en une question', () => {
    const result = extractContact(form([field('f1', 'short_text', 'Nom complet')]), {
      f1: 'Bruno Payet'
    });

    expect(result.name).toBe('Bruno Payet');
  });

  it('reprend l’adresse de la réponse quand aucun champ ne la porte', () => {
    // C'est l'adresse à laquelle la confirmation est partie : celle à laquelle
    // la personne répondra.
    const result = extractContact(form([]), {}, 'depuis-la-reponse@exemple.mu');
    expect(result.email).toBe('depuis-la-reponse@exemple.mu');
  });

  it('trouve téléphone et société sur leur intitulé', () => {
    const result = extractContact(
      form([
        field('f1', 'phone', 'Téléphone'),
        field('f2', 'short_text', 'Entreprise'),
        field('f3', 'short_text', 'Prénom')
      ]),
      { f1: '+230 5 123 4567', f2: 'Acme Ltd', f3: 'Livinia' }
    );

    expect(result.phone).toBe('+230 5 123 4567');
    expect(result.company).toBe('Acme Ltd');
  });

  it('rend des chaînes vides plutôt que des valeurs absentes', () => {
    // Un contact sans téléphone existe ; un contact dont le téléphone vaut
    // « undefined » à l'export n'existe pas.
    const result = extractContact(form([]), {});
    expect(result).toEqual({ name: '', email: '', phone: '', company: '' });
  });

  it('ignore les champs laissés vides', () => {
    const result = extractContact(
      form([field('f1', 'email', 'E-mail'), field('f2', 'email', 'E-mail de secours')]),
      { f1: '', f2: 'secours@exemple.mu' }
    );

    expect(result.email).toBe('secours@exemple.mu');
  });
});
