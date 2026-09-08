import 'server-only';

import { createAdminClient } from '@/lib/supabase/server';
import { getAccessTokenForTeam } from '@/lib/google/credentials';
import { GoogleApiError } from '@/lib/google/oauth';
import {
  appendRows,
  clearRows,
  ensureSheet,
  syncHeaderRow
} from '@/lib/google/sheets';
import { buildSubmissionColumns, formatSubmissionRow } from '@/lib/submission-format';
import type { Field, Form, FormIntegration, GoogleSheetsConfig } from '@/types';

/**
 * Synchronisation des réponses vers Google Sheets.
 *
 * Deux modes :
 *  · `syncSubmissionToSheets` — appelé après chaque envoi, ajoute une ligne ;
 *  · `resyncAllSubmissions` — remplace le contenu des onglets par l'intégralité
 *    des réponses, pour rattraper une feuille désynchronisée.
 *
 * Une réponse peut partir dans un onglet choisi par sa propre valeur : c'est la
 * répartition (`split_field_id`). « Les inscriptions de Port-Louis dans un
 * onglet, celles de Curepipe dans un autre » est un besoin réel — le contraire,
 * un seul onglet trié à la main après coup, se refait à chaque nouvelle réponse.
 *
 * Aucune de ces deux fonctions ne doit faire échouer l'envoi d'une réponse : une
 * panne côté Google se solde par une ligne d'erreur dans le journal, pas par une
 * réponse perdue. C'est l'appelant qui garantit cela en n'attendant pas le
 * résultat, mais chaque fonction avale déjà ses propres erreurs.
 */

const METADATA_HEADERS = ['Date de soumission', 'Langue', 'Identifiant'];

interface SheetsIntegration extends FormIntegration {
  config: GoogleSheetsConfig;
}

function isSheetsConfig(config: unknown): config is GoogleSheetsConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    typeof (config as GoogleSheetsConfig).spreadsheet_id === 'string' &&
    typeof (config as GoogleSheetsConfig).sheet_title === 'string'
  );
}

async function logEvent(params: {
  integrationId: string;
  formId: string;
  submissionId?: string | null;
  status: 'success' | 'error' | 'skipped';
  message?: string;
}): Promise<void> {
  try {
    await createAdminClient().from('integration_events').insert({
      integration_id: params.integrationId,
      form_id: params.formId,
      submission_id: params.submissionId ?? null,
      status: params.status,
      message: params.message?.slice(0, 500) ?? null
    });
  } catch (error) {
    console.error('Journal des intégrations indisponible:', error);
  }
}

/** Intégration Google Sheets active d'un formulaire, ou `null`. */
async function loadActiveIntegration(formId: string): Promise<SheetsIntegration | null> {
  const { data } = await createAdminClient()
    .from('form_integrations')
    .select('*')
    .eq('form_id', formId)
    .eq('provider', 'google_sheets')
    .eq('is_active', true)
    .maybeSingle();

  if (!data || !isSheetsConfig(data.config)) return null;
  return data as SheetsIntegration;
}

function buildHeaders(form: Form, includeMetadata: boolean): string[] {
  const headers = buildSubmissionColumns(form).map((column) => column.label);
  return includeMetadata ? [...METADATA_HEADERS, ...headers] : headers;
}

/**
 * L'onglet de destination d'une réponse.
 *
 * Aucune règle ne correspond : la réponse va dans l'onglet par défaut, jamais
 * nulle part. Une réponse qui disparaîtrait parce que sa valeur n'était pas
 * prévue serait le pire des deux mondes — pas d'erreur, pas de ligne.
 */
export function resolveTargetSheet(
  config: GoogleSheetsConfig,
  responses: Record<string, unknown>
): string {
  const fallback = config.sheet_title || 'Réponses';
  if (!config.split_field_id) return fallback;

  const value = responses[config.split_field_id];
  // Un choix multiple porte un tableau : c'est la première valeur qui range la
  // ligne, faute de pouvoir l'écrire dans deux onglets à la fois.
  const key = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
  if (!key) return fallback;

  const rule = (config.split_map ?? []).find((entry) => entry.value === key);
  return rule?.tab?.trim() || fallback;
}

/** Le libellé d'une option, pour proposer un nom d'onglet par défaut. */
export function splitOptionsOf(field: Field | undefined): { value: string; label: string }[] {
  if (!field) return [];
  return (field.options ?? []).map((option) => ({
    value: option.id,
    label: option.label?.fr || option.label?.en || option.id
  }));
}

function buildRow(
  form: Form,
  submission: { id: string; responses: Record<string, unknown>; respondent_language?: string; completed_at: string },
  includeMetadata: boolean
): string[] {
  const columns = buildSubmissionColumns(form);
  const answers = formatSubmissionRow(columns, submission.responses ?? {});

  if (!includeMetadata) return answers;

  return [
    new Date(submission.completed_at).toLocaleString('fr-FR'),
    submission.respondent_language ?? 'fr',
    submission.id,
    ...answers
  ];
}

/** Charge le formulaire complet (champs inclus) avec service_role. */
async function loadForm(formId: string): Promise<Form | null> {
  const { data } = await createAdminClient()
    .from('forms')
    .select('*, fields(*)')
    .eq('id', formId)
    .maybeSingle();

  return (data as Form | null) ?? null;
}

/**
 * Ajoute une réponse à la feuille configurée.
 * N'échoue jamais : le résultat part dans le journal des synchronisations.
 */
export async function syncSubmissionToSheets(
  formId: string,
  submissionId: string
): Promise<void> {
  const integration = await loadActiveIntegration(formId);
  if (!integration) return;

  const config = integration.config;

  try {
    const [form, { data: submission }] = await Promise.all([
      loadForm(formId),
      createAdminClient()
        .from('submissions')
        .select('id, responses, respondent_language, completed_at')
        .eq('id', submissionId)
        .maybeSingle()
    ]);

    if (!form || !submission) {
      await logEvent({
        integrationId: integration.id,
        formId,
        submissionId,
        status: 'skipped',
        message: 'Formulaire ou réponse introuvable.'
      });
      return;
    }

    const includeMetadata = config.include_metadata !== false;
    const accessToken = await getAccessTokenForTeam(form.team_id);
    const target = resolveTargetSheet(
      config,
      (submission.responses ?? {}) as Record<string, unknown>
    );

    // L'onglet est créé s'il manque : une répartition qui échouerait parce que
    // l'utilisateur n'a pas créé les onglets à l'avance ne serait pas une
    // fonctionnalité, ce serait une case à cocher qui perd des réponses.
    await ensureSheet(accessToken, config.spreadsheet_id, target);
    await syncHeaderRow(
      accessToken,
      config.spreadsheet_id,
      target,
      buildHeaders(form, includeMetadata)
    );
    await appendRows(accessToken, config.spreadsheet_id, target, [
      buildRow(form, submission, includeMetadata)
    ]);

    await createAdminClient()
      .from('form_integrations')
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq('id', integration.id);

    await logEvent({
      integrationId: integration.id,
      formId,
      submissionId,
      status: 'success',
      message: `Réponse ajoutée à l'onglet « ${target} ».`
    });
  } catch (error) {
    const message =
      error instanceof GoogleApiError
        ? error.message
        : 'Erreur inattendue lors de la synchronisation.';

    console.error('Synchronisation Google Sheets échouée:', error);

    await createAdminClient()
      .from('form_integrations')
      .update({ last_error: message.slice(0, 500) })
      .eq('id', integration.id);

    await logEvent({
      integrationId: integration.id,
      formId,
      submissionId,
      status: 'error',
      message
    });
  }
}

export interface ResyncResult {
  rows: number;
}

/**
 * Réécrit l'onglet complet à partir des réponses en base.
 * Contrairement à `syncSubmissionToSheets`, cette fonction propage ses erreurs :
 * elle est déclenchée manuellement, l'utilisateur attend un retour.
 */
export async function resyncAllSubmissions(formId: string): Promise<ResyncResult> {
  const integration = await loadActiveIntegration(formId);
  if (!integration) {
    throw new GoogleApiError("Aucune intégration Google Sheets active sur ce formulaire.", 400);
  }

  const config = integration.config;
  const form = await loadForm(formId);
  if (!form) throw new GoogleApiError('Formulaire introuvable.', 404);

  const { data: submissions } = await createAdminClient()
    .from('submissions')
    .select('id, responses, respondent_language, completed_at')
    .eq('form_id', formId)
    .eq('is_partial', false)
    .order('completed_at', { ascending: true });

  const includeMetadata = config.include_metadata !== false;
  const accessToken = await getAccessTokenForTeam(form.team_id);
  const headers = buildHeaders(form, includeMetadata);

  /*
   * Les lignes sont d'abord réparties par onglet, puis écrites onglet par
   * onglet.
   *
   * L'onglet par défaut est toujours présent, même vide : sans lui, désactiver
   * la répartition laisserait derrière elle les lignes de l'ancienne
   * configuration, et une resynchronisation censée remettre les choses à plat
   * afficherait les deux états mélangés.
   */
  const byTab = new Map<string, string[][]>();
  byTab.set(config.sheet_title || 'Réponses', []);

  for (const submission of submissions ?? []) {
    const tab = resolveTargetSheet(
      config,
      (submission.responses ?? {}) as Record<string, unknown>
    );
    const rows = byTab.get(tab) ?? [];
    rows.push(buildRow(form, submission, includeMetadata));
    byTab.set(tab, rows);
  }

  let written = 0;
  for (const [tab, rows] of byTab) {
    await ensureSheet(accessToken, config.spreadsheet_id, tab);
    await clearRows(accessToken, config.spreadsheet_id, tab);
    await syncHeaderRow(accessToken, config.spreadsheet_id, tab, headers);

    // Google plafonne la taille d'une requête : on écrit par paquets de 500.
    for (let i = 0; i < rows.length; i += 500) {
      await appendRows(accessToken, config.spreadsheet_id, tab, rows.slice(i, i + 500));
    }
    written += rows.length;
  }

  await createAdminClient()
    .from('form_integrations')
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq('id', integration.id);

  const tabCount = byTab.size;
  await logEvent({
    integrationId: integration.id,
    formId,
    status: 'success',
    message:
      tabCount > 1
        ? `Resynchronisation complète — ${written} ligne${written > 1 ? 's' : ''} sur ${tabCount} onglets.`
        : `Resynchronisation complète — ${written} ligne${written > 1 ? 's' : ''}.`
  });

  return { rows: written };
}
