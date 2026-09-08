import { describe, it, expect } from 'vitest';

import {
  EMPTY_FILTER,
  exportHeaders,
  exportRow,
  exportFilename,
  filterFromParams,
  filterRecords,
  filterToParams,
  isFilterActive,
  statusOf,
  summarize,
  type RecordRow,
  type RecordsFilter
} from '@/lib/records';
import { buildWorkbook, safeSheetName } from '@/lib/xlsx';
import { resolveTargetSheet } from '@/lib/integrations/google-sheets-sync';
import type { Field, FieldOption, Form, GoogleSheetsConfig, TotalsSnapshot } from '@/types';

/**
 * Ce que fixent ces tests décide de ce qu'on lit à l'écran ET de ce qui part
 * dans un fichier envoyé à quelqu'un. Deux propriétés comptent plus que le
 * reste : le tableau et l'export filtrent avec la MÊME fonction, et une réponse
 * annulée cesse de compter dans l'argent sans disparaître du décompte.
 */

function option(id: string, label: string): FieldOption {
  return { id, label: { fr: label } };
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

function form(fields: Field[], extra: Partial<Form> = {}): Form {
  return {
    id: 'form-1',
    team_id: 'team-1',
    title: 'Gala annuel',
    slug: 'gala',
    display_mode: 'scroll',
    status: 'published',
    is_template: false,
    theme: {} as Form['theme'],
    access_type: 'public',
    languages: ['fr'],
    default_language: 'fr',
    fields,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    ...extra
  };
}

function totals(total: number, extra: Partial<TotalsSnapshot> = {}): TotalsSnapshot {
  return {
    currency: 'MUR',
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
    total_label: 'Total',
    ...extra
  };
}

function row(id: string, extra: Partial<RecordRow> = {}): RecordRow {
  return {
    id,
    form_id: 'form-1',
    responses: {},
    completed_at: '2026-09-05T12:00:00.000Z',
    ...extra
  };
}

const FORM = form([
  field('prenom', 'short_text'),
  field('formule', 'single_choice', {
    options: [option('o-table', 'Table de 6'), option('o-place', 'Place seule')],
    field_order: 1
  })
]);

const CONTEXT = { formOf: () => FORM };

// ============================================================================
// Filtres
// ============================================================================

describe('filterRecords', () => {
  it('écarte les ébauches par défaut', () => {
    // Une ébauche n'est pas une réponse : elle n'a jamais été envoyée.
    const rows = [row('a'), row('b', { is_partial: true })];

    expect(filterRecords(rows, EMPTY_FILTER, CONTEXT).map((r) => r.id)).toEqual(['a']);
    expect(
      filterRecords(rows, { ...EMPTY_FILTER, includePartials: true }, CONTEXT)
    ).toHaveLength(2);
  });

  it('filtre par statut, une colonne vide valant « reçue »', () => {
    const rows = [row('a'), row('b', { status: 'paid' }), row('c', { status: 'void' })];

    expect(
      filterRecords(rows, { ...EMPTY_FILTER, status: 'submitted' }, CONTEXT).map((r) => r.id)
    ).toEqual(['a']);
    expect(
      filterRecords(rows, { ...EMPTY_FILTER, status: 'paid' }, CONTEXT).map((r) => r.id)
    ).toEqual(['b']);
  });

  it('inclut la journée entière de la borne haute', () => {
    // Sans cela, filtrer « jusqu'au 5 » exclurait tout le 5, et l'utilisateur
    // conclurait qu'il n'y a rien eu ce jour-là.
    const rows = [
      row('matin', { completed_at: '2026-09-05T00:30:00.000Z' }),
      row('soir', { completed_at: '2026-09-05T23:30:00.000Z' }),
      row('lendemain', { completed_at: '2026-09-06T09:00:00.000Z' })
    ];

    const kept = filterRecords(
      rows,
      { ...EMPTY_FILTER, from: '2026-09-05', to: '2026-09-05', tz_offset: 0 },
      CONTEXT
    );

    expect(kept.map((r) => r.id)).toEqual(['matin', 'soir']);
  });

  it('borne la journée dans le fuseau du répondant, pas celui de la machine', () => {
    /*
     * C'est le défaut que ce champ corrige. « Le 5 septembre » ne désigne pas le
     * même intervalle d'instants à Port-Louis (UTC+4) et à Londres : une
     * inscription à 21 h 00 UTC le 5 a lieu le 6 au matin pour un Mauricien.
     *
     * Le tableau filtrait dans le fuseau du navigateur et l'export dans celui du
     * serveur : le même filtre retenait deux ensembles différents, et l'écart ne
     * se voyait qu'en comparant le fichier au tableau, ligne à ligne.
     */
    const rows = [row('tard', { completed_at: '2026-09-05T21:00:00.000Z' })];
    const bounds = { from: '2026-09-05', to: '2026-09-05' };

    // UTC+4 : `getTimezoneOffset` rend -240.
    expect(
      filterRecords(rows, { ...EMPTY_FILTER, ...bounds, tz_offset: -240 }, CONTEXT)
    ).toHaveLength(0);
    expect(filterRecords(rows, { ...EMPTY_FILTER, ...bounds, tz_offset: 0 }, CONTEXT)).toHaveLength(
      1
    );
  });

  it('cherche dans le numéro, l’adresse et les libellés d’option', () => {
    const rows = [
      row('a', { invoice_number: 'CMD-0042' }),
      row('b', { respondent_email: 'livinia@exemple.fr' }),
      row('c', { responses: { formule: 'o-table' } })
    ];

    const find = (search: string) =>
      filterRecords(rows, { ...EMPTY_FILTER, search }, CONTEXT).map((r) => r.id);

    expect(find('cmd-0042')).toEqual(['a']);
    expect(find('LIVINIA')).toEqual(['b']);
    // Le libellé, pas l'identifiant : c'est ce que le tableau affiche.
    expect(find('Table de 6')).toEqual(['c']);
    expect(find('o-table')).toEqual([]);
  });

  it('restreint à un formulaire dans la vue projet', () => {
    const rows = [row('a'), row('b', { form_id: 'form-2' })];

    expect(
      filterRecords(rows, { ...EMPTY_FILTER, formId: 'form-2' }, CONTEXT).map((r) => r.id)
    ).toEqual(['b']);
  });
});

describe('statusOf', () => {
  it('normalise une valeur absente ou inconnue', () => {
    expect(statusOf(row('a'))).toBe('submitted');
    expect(statusOf(row('a', { status: 'inconnu' }))).toBe('submitted');
    expect(statusOf(row('a', { status: 'paid' }))).toBe('paid');
  });
});

describe('filtres dans une URL', () => {
  it('fait l’aller-retour sans rien perdre', () => {
    const filter: RecordsFilter = {
      search: 'livinia',
      status: 'paid',
      language: 'en',
      from: '2026-09-01',
      to: '2026-09-30',
      includePartials: true,
      formId: 'form-2',
      tz_offset: -240
    };

    expect(filterFromParams(filterToParams(filter))).toEqual(filter);
  });

  it('emporte le fuseau dès qu’une date est posée', () => {
    // Sans lui, le serveur bornerait la journée dans son propre fuseau et
    // l'export ne contiendrait pas les lignes du tableau.
    expect(filterToParams({ ...EMPTY_FILTER, from: '2026-09-01' }).get('tz')).not.toBeNull();
    expect(filterToParams({ ...EMPTY_FILTER, search: 'x' }).get('tz')).toBeNull();
  });

  it('n’écrit rien pour un filtre vide', () => {
    expect(filterToParams(EMPTY_FILTER).toString()).toBe('');
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it('rejette un statut et une date qui n’en sont pas', () => {
    // Les paramètres viennent d'une URL : un statut inventé filtrerait sur rien
    // et l'export reviendrait vide sans que rien ne l'explique.
    const params = new URLSearchParams({ status: 'supprimee', from: 'hier', tz: 'midi' });
    const filter = filterFromParams(params);

    expect(filter.status).toBe('all');
    expect(filter.from).toBe('');
    expect(filter.tz_offset).toBe(0);
  });
});

// ============================================================================
// Indicateurs
// ============================================================================

describe('summarize', () => {
  const rows = [
    row('a', { status: 'paid', pricing: totals(1000) }),
    row('b', { status: 'submitted', pricing: totals(500) }),
    row('c', { status: 'void', pricing: totals(9999) }),
    row('d', { status: 'reviewed' })
  ];

  it('exclut une réponse annulée du chiffre d’affaires, sans l’effacer du décompte', () => {
    // Elle a bien été reçue ; elle ne sera simplement jamais encaissée. Les
    // confondre ferait disparaître des lignes du tableau de bord sans que rien
    // n'explique où elles sont passées.
    const summary = summarize(rows);

    expect(summary.total).toBe(4);
    expect(summary.byStatus.void).toBe(1);
    expect(summary.revenue?.billed).toBe(1500);
    expect(summary.revenue?.count).toBe(2);
  });

  it('n’encaisse que ce qui est marqué payé', () => {
    expect(summarize(rows).revenue?.collected).toBe(1000);
  });

  it('calcule le panier moyen sur les seules réponses chiffrées', () => {
    // `d` n'a pas de total : la compter diviserait par trois un montant qui n'a
    // que deux lignes derrière lui.
    expect(summarize(rows).revenue?.average).toBe(750);
  });

  it('ne produit aucun montant quand rien n’est facturé', () => {
    expect(summarize([row('a'), row('b')]).revenue).toBeUndefined();
  });

  it('referme la dérive des flottants', () => {
    const cents = [row('a', { pricing: totals(0.1) }), row('b', { pricing: totals(0.2) })];
    expect(summarize(cents).revenue?.billed).toBe(0.3);
  });
});

// ============================================================================
// Export
// ============================================================================

describe('colonnes d’export', () => {
  it('place les métadonnées avant les questions', () => {
    // C'est par elles qu'on retrouve une ligne dans un tableur ; un formulaire
    // de quarante questions les repousserait hors de l'écran.
    const headers = exportHeaders(FORM, { includeInvoiceNumber: true, includePricing: true });

    expect(headers.slice(0, 5)).toEqual([
      'Date de soumission',
      'Statut',
      'Numéro',
      'Langue',
      'E-mail du répondant'
    ]);
    expect(headers).toContain('prenom');
    expect(headers.at(-1)).toBe('Identifiant');
  });

  it('n’ajoute une colonne que si elle est demandée', () => {
    const headers = exportHeaders(FORM);
    expect(headers).not.toContain('Numéro');
    expect(headers).not.toContain('Total');
  });

  it('écrit les montants en nombres, et la remise en négatif', () => {
    // Dans un tableur, une somme est ce qu'on fait d'une colonne de prix :
    // « MUR 3 450,00 » ne s'additionne pas.
    const values = exportRow(
      FORM,
      row('a', { pricing: totals(1150, { subtotal: 1000, discount: 100, vat: 250 }) }),
      { includePricing: true }
    );

    expect(values).toContain(1000);
    expect(values).toContain(-100);
    expect(values).toContain(1150);
    expect(values).toContain('MUR');
  });

  it('laisse les colonnes de totaux vides sur une réponse non chiffrée', () => {
    const headers = exportHeaders(FORM, { includePricing: true });
    const values = exportRow(FORM, row('a'), { includePricing: true });

    expect(values).toHaveLength(headers.length);
    expect(values[headers.indexOf('Total')]).toBe('');
  });

  it('aligne toujours la ligne sur son en-tête', () => {
    const options = { includeInvoiceNumber: true, includePricing: true };
    expect(exportRow(FORM, row('a'), options)).toHaveLength(
      exportHeaders(FORM, options).length
    );
  });
});

describe('exportFilename', () => {
  it('produit un nom sûr, daté', () => {
    expect(exportFilename('Gala annuel — Inscriptions')).toMatch(
      /^gala-annuel-inscriptions-\d{4}-\d{2}-\d{2}\.xlsx$/
    );
    expect(exportFilename('  ')).toMatch(/^reponses-/);
  });
});

// ============================================================================
// Classeur
// ============================================================================

describe('safeSheetName', () => {
  it('retire ce qu’Excel refuse, et tronque à trente et un caractères', () => {
    // Excel ne refuse pas l'onglet : il refuse le FICHIER. Un onglet nommé
    // d'après une réponse libre produirait donc un classeur illisible.
    expect(safeSheetName('Formule : Table de 6 / 2026')).toBe('Formule Table de 6 2026');
    expect(safeSheetName('x'.repeat(60))).toHaveLength(31);
    expect(safeSheetName('[]')).toBe('Réponses');
  });
});

describe('buildWorkbook', () => {
  it('écrit un classeur lisible', async () => {
    const buffer = await buildWorkbook([
      { name: 'Réponses', headers: ['A', 'B'], rows: [['x', 1]] }
    ]);

    // Un .xlsx est une archive ZIP : les deux premiers octets le disent.
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('distingue deux onglets que la troncature rendrait identiques', async () => {
    // Excel refuse aussi deux onglets de même nom, et là encore c'est le fichier
    // entier qui est rejeté.
    const long = 'Inscriptions au gala annuel de fin';
    const buffer = await buildWorkbook([
      { name: `${long} A`, headers: ['A'], rows: [] },
      { name: `${long} B`, headers: ['A'], rows: [] }
    ]);

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('refuse un classeur sans onglet', async () => {
    await expect(buildWorkbook([])).rejects.toThrow();
  });
});

// ============================================================================
// Répartition Google Sheets
// ============================================================================

describe('resolveTargetSheet', () => {
  const config: GoogleSheetsConfig = {
    spreadsheet_id: 'abc',
    sheet_title: 'Réponses',
    split_field_id: 'formule',
    split_map: [
      { value: 'o-table', tab: 'Tables' },
      { value: 'o-place', tab: 'Places' }
    ]
  };

  it('range la ligne dans l’onglet de sa valeur', () => {
    expect(resolveTargetSheet(config, { formule: 'o-table' })).toBe('Tables');
  });

  it('retombe sur l’onglet par défaut, jamais nulle part', () => {
    // Une réponse qui disparaîtrait parce que sa valeur n'était pas prévue
    // serait le pire des deux mondes : pas d'erreur, pas de ligne.
    expect(resolveTargetSheet(config, { formule: 'o-inconnue' })).toBe('Réponses');
    expect(resolveTargetSheet(config, {})).toBe('Réponses');
    expect(resolveTargetSheet({ ...config, split_field_id: undefined }, { formule: 'o-table' })).toBe(
      'Réponses'
    );
  });

  it('range un choix multiple d’après sa première valeur', () => {
    expect(resolveTargetSheet(config, { formule: ['o-place', 'o-table'] })).toBe('Places');
  });
});
