'use client';

/**
 * Historique de versions d'un formulaire.
 *
 * Un instantané fige le contenu — métadonnées d'édition, champs, règles
 * logiques — et permet d'y revenir. Il arrive avant l'IA, et pas après : une
 * construction pilotée par IA qu'on ne peut pas annuler n'est pas utilisable.
 * Chaque lot d'appels d'outils sera encapsulé dans un instantané de type `ai`,
 * ce qui rend « annuler ce que l'IA vient de faire » atteignable en un clic.
 */

import type { Form, FormSnapshot, FormVersion, FormVersionKind } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { getForm, toFieldRow, toLogicRuleRow } from './supabase-forms';

/**
 * Nombre d'instantanés automatiques conservés par formulaire.
 *
 * Les instantanés nommés (`manual`) et ceux de l'IA (`ai`) ne sont jamais
 * élagués : quelqu'un les a voulus, ou ils documentent une action qu'on peut
 * vouloir défaire longtemps après.
 */
const MAX_AUTO_VERSIONS = 20;

/**
 * Ce qu'un instantané retient du formulaire lui-même.
 *
 * Volontairement restreint au contenu éditorial. `status`, `slug` et
 * `published_at` en sont absents : restaurer une version doit ramener des
 * questions, pas dépublier un formulaire en ligne ni changer l'adresse publique
 * qui a déjà circulé.
 */
const SNAPSHOT_FORM_KEYS = [
  'title',
  'description',
  'display_mode',
  'theme',
  'settings',
  'languages',
  'default_language',
  'scoring_enabled',
  'show_score_to_respondent',
  'save_and_resume',
  'unique_email',
  'require_all_by_default'
] as const satisfies readonly (keyof Form)[];

function pickFormMeta(form: Form): Partial<Form> {
  const meta: Partial<Form> = {};
  for (const key of SNAPSHOT_FORM_KEYS) {
    const value = form[key];
    if (value !== undefined) (meta as Record<string, unknown>)[key] = value;
  }
  return meta;
}

interface VersionRow {
  id: string;
  form_id: string;
  snapshot: FormSnapshot;
  label: string | null;
  kind: FormVersionKind | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

function toVersion(row: VersionRow): FormVersion {
  return {
    id: row.id,
    form_id: row.form_id,
    snapshot: row.snapshot,
    label: row.label ?? '',
    kind: row.kind ?? 'auto',
    created_by: row.created_by,
    created_by_name: row.created_by_name ?? '',
    created_at: row.created_at
  };
}

async function currentUser() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user;
}

// ============================================================================
// Lecture
// ============================================================================

export async function listFormVersions(formId: string, limit = 50): Promise<FormVersion[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('form_versions')
    .select('*')
    .eq('form_id', formId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => toVersion(row as VersionRow));
}

// ============================================================================
// Écriture
// ============================================================================

export interface SnapshotOptions {
  kind?: FormVersionKind;
  label?: string;
}

/**
 * Fige l'état courant d'un formulaire.
 *
 * Renvoie `null` si le formulaire est introuvable — un instantané raté ne doit
 * jamais interrompre l'action qui l'a déclenché : on préfère perdre un point de
 * restauration que bloquer une édition.
 */
export async function snapshotForm(
  formId: string,
  options: SnapshotOptions = {}
): Promise<FormVersion | null> {
  const supabase = createClient();

  const form = await getForm(formId);
  if (!form) return null;

  const snapshot: FormSnapshot = {
    form: pickFormMeta(form),
    fields: form.fields ?? [],
    logic_rules: form.logic_rules ?? []
  };

  const user = await currentUser();
  const kind = options.kind ?? 'auto';

  const { data, error } = await supabase
    .from('form_versions')
    .insert({
      form_id: formId,
      snapshot,
      label: options.label ?? '',
      kind,
      created_by: user?.id ?? null,
      created_by_name:
        (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''
    })
    .select()
    .single();

  if (error) throw error;

  if (kind === 'auto') await pruneAutoVersions(formId);

  return toVersion(data as VersionRow);
}

/** Ne garde que les `MAX_AUTO_VERSIONS` instantanés automatiques les plus récents. */
async function pruneAutoVersions(formId: string): Promise<void> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('form_versions')
    .select('id')
    .eq('form_id', formId)
    .eq('kind', 'auto')
    .order('created_at', { ascending: false });

  if (error || !data || data.length <= MAX_AUTO_VERSIONS) return;

  const stale = data.slice(MAX_AUTO_VERSIONS).map((row) => row.id as string);
  if (stale.length === 0) return;

  await supabase.from('form_versions').delete().in('id', stale);
}

/**
 * Restaure un instantané.
 *
 * L'état courant est figé d'abord : une restauration est elle-même annulable,
 * sans quoi un clic malheureux détruirait le travail en cours sans recours.
 *
 * Les champs sont remplacés en bloc plutôt que rapprochés un à un. Leurs
 * identifiants sont ceux de l'instantané, donc les réponses déjà collectées
 * continuent de désigner les mêmes questions.
 */
export async function restoreFormVersion(formId: string, versionId: string): Promise<Form | null> {
  const supabase = createClient();

  const { data: row, error: readError } = await supabase
    .from('form_versions')
    .select('*')
    .eq('id', versionId)
    .eq('form_id', formId)
    .maybeSingle();

  if (readError) throw readError;
  if (!row) return null;

  const version = toVersion(row as VersionRow);

  await snapshotForm(formId, { kind: 'auto', label: 'Avant restauration' });

  const { fields, logic_rules: logicRules, form: meta } = version.snapshot;

  // Les règles partent avant les champs : elles portent une clé étrangère vers
  // `target_field_id`, et supprimer un champ encore cité ferait échouer l'ordre.
  const { error: rulesDeleteError } = await supabase
    .from('logic_rules')
    .delete()
    .eq('form_id', formId);
  if (rulesDeleteError) throw rulesDeleteError;

  const { error: fieldsDeleteError } = await supabase
    .from('fields')
    .delete()
    .eq('form_id', formId);
  if (fieldsDeleteError) throw fieldsDeleteError;

  if (fields.length > 0) {
    const { error } = await supabase
      .from('fields')
      .insert(fields.map((field) => toFieldRow(field, formId)));
    if (error) throw error;
  }

  if (logicRules.length > 0) {
    const { error } = await supabase
      .from('logic_rules')
      .insert(logicRules.map((rule) => toLogicRuleRow(rule, formId)));
    if (error) throw error;
  }

  const { error: metaError } = await supabase
    .from('forms')
    .update({ ...meta, updated_at: new Date().toISOString() })
    .eq('id', formId);
  if (metaError) throw metaError;

  return getForm(formId);
}

export async function deleteFormVersion(versionId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('form_versions').delete().eq('id', versionId);
  if (error) throw error;
}
