import 'server-only';

import { createAdminClient } from '@/lib/supabase/server';
import { formatAnswer } from '@/lib/submission-format';
import type { Field, Form, FormSettings } from '@/types';

/**
 * Règles d'acceptation d'une réponse, définies dans l'onglet « Paramètres » du
 * formulaire.
 *
 * Elles sont appliquées ici, côté serveur, et non dans le navigateur : le
 * quota de réponses et la détection de doublon sont précisément le genre de
 * contrôle qu'un répondant motivé contournerait en une requête.
 */

export interface GuardFailure {
  status: number;
  error: string;
}

/** Nombre de réponses abouties (les ébauches ne comptent pas). */
export async function countCompletedSubmissions(formId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('form_id', formId)
    .eq('is_partial', false);

  return count ?? 0;
}

/** Le quota de réponses fixé par l'auteur est-il atteint ? */
export async function checkSubmissionLimit(
  formId: string,
  settings: FormSettings
): Promise<GuardFailure | null> {
  if (!settings.max_submissions_enabled) return null;

  const max = Number(settings.max_submissions);
  if (!Number.isFinite(max) || max <= 0) return null;

  const current = await countCompletedSubmissions(formId);
  if (current < max) return null;

  return {
    status: 403,
    error:
      settings.closed_message?.trim() ||
      'Ce formulaire a atteint son nombre maximal de réponses.'
  };
}

/**
 * Doublon sur le champ désigné comme identifiant unique.
 *
 * Contrairement à `unique_email`, qui s'appuie sur la colonne dédiée
 * `respondent_email`, ce contrôle peut porter sur n'importe quel champ — un
 * numéro de téléphone, un matricule. Il compare la valeur mise en forme, celle
 * que l'auteur du formulaire voit dans son tableau.
 */
export async function checkDuplicateAnswer(
  form: Form,
  fields: Field[],
  responses: Record<string, unknown>,
  settings: FormSettings,
  excludeSubmissionId?: string
): Promise<GuardFailure | null> {
  if (!settings.prevent_duplicates || !settings.duplicate_field_id) return null;

  const field = fields.find((f) => f.id === settings.duplicate_field_id);
  if (!field) return null;

  const value = formatAnswer(field, responses[field.id]).trim().toLowerCase();
  if (!value) return null;

  const { data: existing } = await createAdminClient()
    .from('submissions')
    .select('id, responses')
    .eq('form_id', form.id)
    .eq('is_partial', false);

  const clash = (existing ?? []).some((submission) => {
    if (excludeSubmissionId && submission.id === excludeSubmissionId) return false;
    const other = formatAnswer(field, (submission.responses ?? {})[field.id]).trim().toLowerCase();
    return other !== '' && other === value;
  });

  if (!clash) return null;

  return {
    status: 409,
    error: `Une réponse a déjà été enregistrée pour « ${
      field.label?.fr || 'ce champ'
    } ». Un seul envoi est autorisé.`
  };
}

/**
 * Purge des réponses expirées.
 *
 * Papyrus n'a pas d'ordonnanceur : la rétention est appliquée paresseusement, à
 * chaque nouvel envoi sur le formulaire concerné. Un formulaire qui ne reçoit
 * plus rien ne se purge donc plus — c'est le compromis assumé, et la purge se
 * déclenche aussi à l'enregistrement des paramètres.
 */
export async function enforceDataRetention(
  formId: string,
  settings: FormSettings
): Promise<number> {
  if (!settings.data_retention_enabled) return 0;

  const days = Number(settings.data_retention_days);
  if (!Number.isFinite(days) || days <= 0) return 0;

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await createAdminClient()
    .from('submissions')
    .delete()
    .eq('form_id', formId)
    .lt('completed_at', cutoff)
    .select('id');

  if (error) {
    console.error('Purge de rétention échouée:', error);
    return 0;
  }

  return data?.length ?? 0;
}
