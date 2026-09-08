import { formatMoney } from '@/lib/pricing';
import { buildSubmissionColumns, formatSubmissionRow } from '@/lib/submission-format';
import { SUBMISSION_STATUS_LABELS, SUBMISSION_STATUSES } from '@/types';
import type { Form, SubmissionStatus, TotalsSnapshot } from '@/types';

/**
 * Le filtrage et la mise en colonnes des réponses.
 *
 * Un seul module pour les deux, et c'est le point : le tableau à l'écran et le
 * fichier exporté doivent contenir exactement les mêmes lignes. Exporter « tout »
 * quand l'écran montre « les payées de septembre » est le genre d'écart qu'on ne
 * remarque qu'après avoir envoyé le fichier à quelqu'un.
 */

// ============================================================================
// Filtres
// ============================================================================

export interface RecordsFilter {
  /** Cherché dans le numéro, l'adresse e-mail et toutes les réponses. */
  search: string;
  status: SubmissionStatus | 'all';
  language: string | 'all';
  /** Bornes incluses, au format `AAAA-MM-JJ`. */
  from: string;
  to: string;
  /**
   * Décalage horaire du répondant, en minutes, à la façon de
   * `Date.prototype.getTimezoneOffset` — donc positif à l'ouest de Greenwich.
   *
   * Il existe parce que « du 1er au 8 septembre » ne désigne pas le même
   * intervalle d'instants selon l'endroit d'où on le lit. Sans lui, le tableau
   * filtrait dans le fuseau du navigateur et l'export dans celui du serveur :
   * le même filtre retenait deux ensembles de lignes différents, et l'écart ne
   * se voyait qu'en comparant le fichier au tableau, ligne à ligne.
   */
  tz_offset?: number;
  /** Les ébauches sont exclues par défaut : ce ne sont pas des réponses. */
  includePartials: boolean;
  /** Vue projet : restreint à un formulaire. */
  formId: string | 'all';
}

export const EMPTY_FILTER: RecordsFilter = {
  search: '',
  status: 'all',
  language: 'all',
  from: '',
  to: '',
  includePartials: false,
  formId: 'all'
};

/** Le fuseau à appliquer : celui du filtre, sinon celui d'ici. */
function offsetOf(filter: RecordsFilter): number {
  return filter.tz_offset ?? new Date().getTimezoneOffset();
}

/**
 * L'instant où commence une date, dans le fuseau demandé.
 * `end` pousse à la milliseconde qui précède minuit : la borne haute est incluse,
 * sans quoi filtrer « jusqu'au 8 » exclurait tout le 8.
 */
function boundary(day: string, offsetMinutes: number, end: boolean): number {
  const [year, month, date] = day.split('-').map(Number);
  return (
    Date.UTC(year, month - 1, date, 0, 0, 0, 0) +
    offsetMinutes * 60_000 +
    (end ? 86_399_999 : 0)
  );
}

export function isFilterActive(filter: RecordsFilter): boolean {
  return (
    filter.search.trim() !== '' ||
    filter.status !== 'all' ||
    filter.language !== 'all' ||
    filter.from !== '' ||
    filter.to !== '' ||
    filter.includePartials ||
    filter.formId !== 'all'
  );
}

/** Ce qu'une réponse porte, du point de vue du filtrage et de l'export. */
export interface RecordRow {
  id: string;
  form_id: string;
  responses?: Record<string, unknown> | null;
  respondent_email?: string | null;
  respondent_language?: string | null;
  completed_at: string;
  is_partial?: boolean | null;
  status?: string | null;
  invoice_number?: string | null;
  email_sent_at?: string | null;
  email_error?: string | null;
  pricing?: TotalsSnapshot | null;
}

/** Le statut d'une ligne, normalisé — une colonne vide vaut « reçue ». */
export function statusOf(row: RecordRow): SubmissionStatus {
  const value = row.status ?? '';
  return (SUBMISSION_STATUSES as string[]).includes(value)
    ? (value as SubmissionStatus)
    : 'submitted';
}

export function statusLabel(row: RecordRow): string {
  return SUBMISSION_STATUS_LABELS[statusOf(row)];
}

/**
 * Le texte dans lequel la recherche va chercher.
 *
 * Les réponses sont rendues avec `formatSubmissionRow` — donc les libellés
 * d'option, pas leurs identifiants. Chercher « Table de 6 » doit trouver ce que
 * le tableau affiche, pas ce que la base stocke.
 */
export function searchHaystack(form: Form | undefined, row: RecordRow): string {
  const answers = form
    ? formatSubmissionRow(buildSubmissionColumns(form), (row.responses ?? {}) as Record<string, unknown>)
    : [];

  return [row.invoice_number ?? '', row.respondent_email ?? '', ...answers]
    .join(' ')
    .toLowerCase();
}

export interface FilterContext {
  /** Le formulaire d'une ligne — la vue projet en agrège plusieurs. */
  formOf: (row: RecordRow) => Form | undefined;
}

export function filterRecords(
  rows: RecordRow[],
  filter: RecordsFilter,
  context: FilterContext
): RecordRow[] {
  const needle = filter.search.trim().toLowerCase();
  const offset = offsetOf(filter);
  const from = filter.from ? boundary(filter.from, offset, false) : null;
  const to = filter.to ? boundary(filter.to, offset, true) : null;

  return rows.filter((row) => {
    if (!filter.includePartials && row.is_partial) return false;
    if (filter.formId !== 'all' && row.form_id !== filter.formId) return false;
    if (filter.status !== 'all' && statusOf(row) !== filter.status) return false;
    if (filter.language !== 'all' && (row.respondent_language ?? 'fr') !== filter.language) {
      return false;
    }

    if (from !== null || to !== null) {
      const at = new Date(row.completed_at).getTime();
      if (Number.isNaN(at)) return false;
      if (from !== null && at < from) return false;
      if (to !== null && at > to) return false;
    }

    if (needle && !searchHaystack(context.formOf(row), row).includes(needle)) return false;

    return true;
  });
}

/** Lit un filtre depuis une URL — c'est ainsi que l'export reçoit celui de l'écran. */
export function filterFromParams(params: URLSearchParams): RecordsFilter {
  const status = params.get('status') ?? 'all';
  return {
    search: (params.get('search') ?? '').slice(0, 200),
    status: (SUBMISSION_STATUSES as string[]).includes(status)
      ? (status as SubmissionStatus)
      : 'all',
    language: (params.get('language') ?? 'all').slice(0, 10),
    from: sanitizeDate(params.get('from')),
    to: sanitizeDate(params.get('to')),
    includePartials: params.get('partials') === '1',
    formId: (params.get('form') ?? 'all').slice(0, 40),
    // Absent : UTC, et non le fuseau du serveur. Une valeur déterministe vaut
    // mieux qu'une valeur qui dépend de l'endroit où la machine est hébergée.
    tz_offset: sanitizeOffset(params.get('tz'))
  };
}

/** Écrit un filtre dans une URL, pour le passer à la route d'export. */
export function filterToParams(filter: RecordsFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.search.trim()) params.set('search', filter.search.trim());
  if (filter.status !== 'all') params.set('status', filter.status);
  if (filter.language !== 'all') params.set('language', filter.language);
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.includePartials) params.set('partials', '1');
  if (filter.formId !== 'all') params.set('form', filter.formId);
  // Le fuseau ne voyage que s'il sert : c'est le seul paramètre qui change le
  // sens des deux précédents.
  if (filter.from || filter.to) params.set('tz', String(offsetOf(filter)));
  return params;
}

function sanitizeOffset(value: string | null): number {
  const minutes = Number(value);
  // Les fuseaux réels vont de UTC-12 à UTC+14.
  return Number.isFinite(minutes) && Math.abs(minutes) <= 840 ? minutes : 0;
}

function sanitizeDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

// ============================================================================
// Colonnes d'export
// ============================================================================

export interface ExportOptions {
  /** Ajoute les colonnes de totaux. Décidé par l'appelant, pas deviné ici. */
  includePricing?: boolean;
  /** Ajoute la colonne du numéro de bon de commande. */
  includeInvoiceNumber?: boolean;
}

/**
 * Les en-têtes d'un export.
 *
 * Les métadonnées viennent en premier — date, statut, numéro — parce que c'est
 * par elles qu'on retrouve une ligne dans un tableur, et qu'un formulaire de
 * quarante questions les repousserait hors de l'écran.
 */
export function exportHeaders(form: Form, options: ExportOptions = {}): string[] {
  const headers: string[] = ['Date de soumission', 'Statut'];
  if (options.includeInvoiceNumber) headers.push('Numéro');
  headers.push('Langue', 'E-mail du répondant');

  headers.push(...buildSubmissionColumns(form).map((column) => column.label));

  if (options.includePricing) {
    headers.push('Sous-total', 'Remise', 'TVA', 'Total', 'Devise');
  }

  headers.push('Identifiant');
  return headers;
}

export function exportRow(
  form: Form,
  row: RecordRow,
  options: ExportOptions = {}
): (string | number)[] {
  const values: (string | number)[] = [formatDateTime(row.completed_at), statusLabel(row)];
  if (options.includeInvoiceNumber) values.push(row.invoice_number ?? '');
  values.push(row.respondent_language ?? 'fr', row.respondent_email ?? '');

  values.push(
    ...formatSubmissionRow(
      buildSubmissionColumns(form),
      (row.responses ?? {}) as Record<string, unknown>
    )
  );

  if (options.includePricing) {
    const totals = row.pricing;
    // Les montants partent en NOMBRES, pas en texte : dans un tableur, une somme
    // est ce qu'on fait d'une colonne de prix, et « MUR 3 450,00 » ne s'additionne
    // pas. La devise a sa propre colonne.
    values.push(
      totals ? totals.subtotal : '',
      totals && totals.discount > 0 ? -totals.discount : '',
      totals ? totals.vat : '',
      totals ? totals.total : '',
      totals ? totals.currency : ''
    );
  }

  values.push(row.id);
  return values;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('fr-FR');
}

/** Nom de fichier sûr, dérivé d'un titre libre. */
export function exportFilename(title: string, extension = 'xlsx'): string {
  const slug =
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'reponses';

  return `${slug}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

// ============================================================================
// Indicateurs
// ============================================================================

export interface RecordsSummary {
  total: number;
  byStatus: Record<SubmissionStatus, number>;
  /** Renseigné seulement quand des réponses portent des totaux. */
  revenue?: {
    currency: string;
    currencyPosition: 'before' | 'after';
    /** Somme des totaux, hors réponses annulées. */
    billed: number;
    /** Somme des totaux des seules réponses payées. */
    collected: number;
    /** Panier moyen des réponses facturées. */
    average: number;
    count: number;
  };
}

/**
 * Les chiffres affichés au-dessus du tableau, et dans l'onglet Analyse.
 *
 * Une réponse annulée est exclue du chiffre d'affaires mais reste comptée dans
 * le total des réponses : elle a bien été reçue, elle ne sera simplement jamais
 * encaissée. Confondre les deux ferait disparaître des lignes du tableau de bord
 * sans que rien n'explique où elles sont passées.
 */
export function summarize(rows: RecordRow[]): RecordsSummary {
  const byStatus: Record<SubmissionStatus, number> = {
    submitted: 0,
    reviewed: 0,
    paid: 0,
    void: 0
  };

  let billed = 0;
  let collected = 0;
  let count = 0;
  let currency = '';
  let currencyPosition: 'before' | 'after' = 'before';

  for (const row of rows) {
    const status = statusOf(row);
    byStatus[status] += 1;

    const totals = row.pricing;
    if (!totals || typeof totals.total !== 'number' || status === 'void') continue;

    billed += totals.total;
    if (status === 'paid') collected += totals.total;
    count += 1;
    if (!currency) {
      currency = totals.currency;
      currencyPosition = totals.currency_position;
    }
  }

  const summary: RecordsSummary = { total: rows.length, byStatus };

  if (count > 0) {
    summary.revenue = {
      currency,
      currencyPosition,
      billed: round2(billed),
      collected: round2(collected),
      average: round2(billed / count),
      count
    };
  }

  return summary;
}

/**
 * Deux décimales.
 *
 * Additionner des flottants dérive : `0.1 + 0.2` vaut `0.30000000000000004`, et
 * sur trois cents réponses la dérive s'affiche. Les totaux figés sont déjà justes
 * — c'est leur somme qu'il faut refermer.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatSummaryMoney(
  amount: number,
  revenue: NonNullable<RecordsSummary['revenue']>
): string {
  return formatMoney(amount, revenue.currency, revenue.currencyPosition);
}
