import 'server-only';

import { createAdminClient } from '@/lib/supabase/server';
import {
  exportHeaders,
  exportRow,
  filterRecords,
  type RecordRow,
  type RecordsFilter
} from '@/lib/records';
import { buildWorkbook, type SheetData } from '@/lib/xlsx';
import type { Field, Form, LogicRule, Section } from '@/types';

/**
 * Ce que les routes d'export ont en commun : charger des formulaires complets,
 * charger leurs réponses, appliquer le MÊME filtre que l'écran, et rendre un
 * classeur.
 *
 * Le filtre est réappliqué côté serveur plutôt que de recevoir une liste
 * d'identifiants : une liste vieillie de quelques minutes exporterait des lignes
 * supprimées entre-temps, et manquerait celles arrivées depuis.
 */

/** Colonnes strictement nécessaires — une réponse peut peser plusieurs kilo-octets. */
const SUBMISSION_COLUMNS =
  'id, form_id, responses, respondent_email, respondent_language, completed_at, is_partial, status, invoice_number, pricing';

/**
 * Charge un formulaire avec ses sections, champs et règles, dans l'ordre de
 * lecture.
 *
 * `field_order` est relatif à sa section depuis la phase 1b : trier sur ce seul
 * critère entrelacerait les sections, et les colonnes de l'export ne seraient
 * plus dans l'ordre du formulaire.
 */
export async function loadFormForExport(formId: string): Promise<Form | null> {
  const { data } = await createAdminClient()
    .from('forms')
    .select('*, sections(*), fields(*), logic_rules(*), projects(pricing)')
    .eq('id', formId)
    .maybeSingle();

  return data ? orderForm(data) : null;
}

/** Tous les formulaires d'un projet, dans l'ordre de leur création. */
export async function loadProjectFormsForExport(projectId: string): Promise<Form[]> {
  const { data } = await createAdminClient()
    .from('forms')
    .select('*, sections(*), fields(*), logic_rules(*), projects(pricing)')
    .eq('project_id', projectId)
    .eq('is_template', false)
    .order('created_at', { ascending: true });

  return (data ?? []).map(orderForm);
}

function orderForm(raw: Record<string, unknown>): Form {
  const sections = ((raw.sections ?? []) as Section[]).sort(
    (a, b) => a.section_order - b.section_order
  );
  const rank = new Map(sections.map((section) => [section.id, section.section_order]));

  const fields = ((raw.fields ?? []) as Field[]).sort((a, b) => {
    const bySection =
      (rank.get(a.section_id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.section_id) ?? Number.MAX_SAFE_INTEGER);
    return bySection !== 0 ? bySection : a.field_order - b.field_order;
  });

  return {
    ...(raw as unknown as Form),
    sections,
    fields,
    logic_rules: (raw.logic_rules ?? []) as LogicRule[],
    project_pricing: (raw as { projects?: { pricing?: Form['project_pricing'] } | null }).projects
      ?.pricing
  };
}

/** Les réponses de plusieurs formulaires, de la plus ancienne à la plus récente. */
export async function loadRecords(formIds: string[]): Promise<RecordRow[]> {
  if (formIds.length === 0) return [];

  const { data } = await createAdminClient()
    .from('submissions')
    .select(SUBMISSION_COLUMNS)
    .in('form_id', formIds)
    .order('completed_at', { ascending: true });

  return (data ?? []) as unknown as RecordRow[];
}

export interface ExportRequest {
  forms: Form[];
  filter: RecordsFilter;
  /** Nom de l'onglet quand un seul formulaire est exporté. */
  title: string;
}

export interface ExportResult {
  buffer: Buffer;
  rows: number;
}

export async function buildRecordsWorkbook(request: ExportRequest): Promise<ExportResult> {
  // Un filtre sur un formulaire précis réduit aussi la liste des onglets : rien
  // ne sert d'écrire douze onglets vides parce que l'écran n'en montre qu'un.
  const forms =
    request.filter.formId === 'all'
      ? request.forms
      : request.forms.filter((form) => form.id === request.filter.formId);

  if (forms.length === 0) {
    throw new Error('Aucun formulaire à exporter.');
  }

  const byId = new Map(forms.map((form) => [form.id, form] as const));
  const all = await loadRecords(forms.map((form) => form.id));
  const rows = filterRecords(all, request.filter, { formOf: (row) => byId.get(row.form_id) });

  // Ces deux colonnes coûtent de la largeur : elles n'apparaissent que si elles
  // portent quelque chose. Un sondage exporté avec des colonnes « Numéro » et
  // « Total » vides sur toute la hauteur est plus difficile à lire, pas plus
  // complet.
  const options = {
    includeInvoiceNumber: rows.some((row) => Boolean(row.invoice_number)),
    includePricing: rows.some((row) => Boolean(row.pricing))
  };

  /*
   * Plusieurs formulaires : un onglet chacun, jamais une feuille commune.
   *
   * Deux formulaires n'ont pas les mêmes questions, donc pas les mêmes colonnes.
   * Les empiler sous un seul en-tête ferait glisser les réponses du second sous
   * les intitulés du premier — un fichier qui s'ouvre sans erreur, se lit sans
   * soupçon, et dit n'importe quoi.
   *
   * Un formulaire sans réponse garde son onglet : son absence se lirait comme un
   * oubli d'export, alors que c'est une information.
   */
  const sheets: SheetData[] = forms.map((form) => ({
    name: forms.length === 1 ? request.title : form.title || 'Formulaire',
    headers: exportHeaders(form, options),
    rows: rows
      .filter((row) => row.form_id === form.id)
      .map((row) => exportRow(form, row, options))
  }));

  return { buffer: await buildWorkbook(sheets), rows: rows.length };
}
