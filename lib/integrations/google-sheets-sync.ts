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
import type { Form, FormIntegration, GoogleSheetsConfig } from '@/types';

/**
 * Synchronisation des réponses vers Google Sheets.
 *
 * Deux modes :
 *  · `syncSubmissionToSheets` — appelé après chaque envoi, ajoute une ligne ;
 *  · `resyncAllSubmissions` — remplace le contenu de l'onglet par l'intégralité
 *    des réponses, pour rattraper une feuille désynchronisée.
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

    await ensureSheet(accessToken, config.spreadsheet_id, config.sheet_title);
    await syncHeaderRow(
      accessToken,
      config.spreadsheet_id,
      config.sheet_title,
      buildHeaders(form, includeMetadata)
    );
    await appendRows(accessToken, config.spreadsheet_id, config.sheet_title, [
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
      message: 'Réponse ajoutée à la feuille.'
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

  await ensureSheet(accessToken, config.spreadsheet_id, config.sheet_title);
  await clearRows(accessToken, config.spreadsheet_id, config.sheet_title);
  await syncHeaderRow(
    accessToken,
    config.spreadsheet_id,
    config.sheet_title,
    buildHeaders(form, includeMetadata)
  );

  const rows = (submissions ?? []).map((submission) =>
    buildRow(form, submission, includeMetadata)
  );

  // Google plafonne la taille d'une requête : on écrit par paquets de 500.
  for (let i = 0; i < rows.length; i += 500) {
    await appendRows(
      accessToken,
      config.spreadsheet_id,
      config.sheet_title,
      rows.slice(i, i + 500)
    );
  }

  await createAdminClient()
    .from('form_integrations')
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq('id', integration.id);

  await logEvent({
    integrationId: integration.id,
    formId,
    status: 'success',
    message: `Resynchronisation complète — ${rows.length} ligne${rows.length > 1 ? 's' : ''}.`
  });

  return { rows: rows.length };
}
