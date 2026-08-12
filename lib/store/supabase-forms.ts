'use client';

import type {
  Field,
  Form,
  FormSettings,
  FormTheme,
  LogicRule,
  MultilingualText,
  NotificationSettings
} from '@/types';
import { createClient } from '@/lib/supabase/client';
import { uniqueSlug } from '@/lib/utils';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyMultilingual(value = ''): MultilingualText {
  return { fr: value };
}

function normalizeMultilingual(val: any): MultilingualText {
  if (!val) return { fr: '' };
  if (typeof val === 'string') return { fr: val };
  if (typeof val === 'object') {
    return {
      fr: val.fr || '',
      ...val
    };
  }
  return { fr: '' };
}

function notifyFormsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('papyrus:forms-changed'));
  }
}

function notifyFormCreated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('papyrus:form-created'));
  }
}

function notifyFormUpdated(formId: string, updatedForm: Form) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('papyrus:form-updated', {
      detail: { formId, form: updatedForm }
    }));
  }
}

function notifyFormDeleted(formId: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('papyrus:form-deleted', {
      detail: { formId }
    }));
  }
}



async function getCurrentUser() {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('User not authenticated');
  return user;
}

function getActiveTeamId(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(^|;)\s*papyrus:active-team-id\s*=\s*([^;]+)/);
  return match ? match[2] : null;
}

/** Liste tous les formulaires triés par updated_at desc. */
export async function listForms(): Promise<Form[]> {
  const supabase = createClient();
  const user = await getCurrentUser();

  // Récupérer toutes les équipes de l'utilisateur
  const { data: memberships, error: memberError } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id);

  if (memberError) {
    console.error('Error fetching user teams in listForms:', memberError);
  }

  const teamIds = memberships?.map((m) => m.team_id) || [];

  // Fallback si aucune appartenance n'est trouvée
  if (teamIds.length === 0) {
    teamIds.push(user.id);
  }

  // Une seule requête avec nested selects pour éviter N+1
  const { data: forms, error } = await supabase
    .from('forms')
    .select(`
      *,
      fields(*),
      logic_rules(*)
    `)
    .in('team_id', teamIds)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching forms:', error);
    throw error;
  }

  // Normaliser la structure et trier les relations
  const normalizedForms = (forms || []).map(form => ({
    ...form,
    fields: (form.fields || []).sort((a: any, b: any) => a.field_order - b.field_order),
    logic_rules: (form.logic_rules || []).sort((a: any, b: any) => a.rule_order - b.rule_order)
  }));

  return normalizedForms;
}

export async function getForm(id: string): Promise<Form | null> {
  const supabase = createClient();

  // Une seule requête avec nested selects pour éviter N+1
  const { data: form, error } = await supabase
    .from('forms')
    .select(`
      *,
      fields(*),
      logic_rules(*)
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching form:', error);
    throw error;
  }

  if (!form) return null;

  // Normaliser la structure et trier les relations
  return {
    ...form,
    fields: (form.fields || []).sort((a: any, b: any) => a.field_order - b.field_order),
    logic_rules: (form.logic_rules || []).sort((a: any, b: any) => a.rule_order - b.rule_order)
  };
}

export async function createForm(title = 'Nouveau formulaire', customTeamId?: string): Promise<Form> {
  const supabase = createClient();
  const user = await getCurrentUser();
  const now = new Date().toISOString();

  // Utiliser le customTeamId s'il est passé, sinon lire le cookie actif, sinon fallback sur l'ID de l'utilisateur
  const teamId = customTeamId || getActiveTeamId() || user.id;

  const formData = {
    team_id: teamId,
    created_by: user.id,
    title,
    slug: uniqueSlug(title),
    description: '',
    display_mode: 'scroll' as const,
    status: 'draft' as const,
    is_template: false,
    template_origin_id: null,
    theme: {
      bg: '#EFF9FE',
      accent: '#052139',
      font: 'Aktiv Grotesk',
      banner_url: null,
      dark_mode: false
    },
    access_type: 'public' as const,
    languages: ['fr'],
    default_language: 'fr',
    published_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now
  };

  const { data: form, error } = await supabase
    .from('forms')
    .insert(formData)
    .select()
    .single();

  if (error) throw error;

  notifyFormsChanged();
  notifyFormCreated();

  return {
    ...form,
    fields: [],
    logic_rules: [],
    save_and_resume: true,
    unique_email: true
  };
}

/**
 * Helper pour synchroniser les entités liées (fields, logic_rules) avec rollback automatique
 */
async function syncRelatedEntities<T extends { id: string }>(
  supabase: ReturnType<typeof createClient>,
  tableName: string,
  formId: string,
  entities: T[] | undefined,
  entityName: string
): Promise<T[]> {
  if (entities === undefined) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .eq('form_id', formId);

    if (error) throw error;

    const result = data || [];
    if (tableName === 'logic_rules') {
      result.sort((a: any, b: any) => a.rule_order - b.rule_order);
    } else if (tableName === 'fields') {
      result.sort((a: any, b: any) => a.field_order - b.field_order);
    }
    return result as T[];
  }

  if (entities.length === 0) {
    // Cas simple : supprimer toutes les entités
    const { error: deleteError } = await supabase
      .from(tableName)
      .delete()
      .eq('form_id', formId);

    if (deleteError) throw deleteError;
    return [];
  }

  // Filtrer les IDs undefined pour éviter les bugs SQL NOT IN
  const validIds = entities
    .map((e) => e.id)
    .filter((id) => id !== undefined && id !== null);

  if (validIds.length === 0) {
    throw new Error(`Tous les ${entityName} doivent avoir un ID valide`);
  }

  if (validIds.length !== entities.length) {
    throw new Error(`Certains ${entityName} ont des IDs undefined ou null`);
  }

  // Étape 1 : Récupérer les entités existantes pour le rollback potentiel
  const { data: existingEntities, error: fetchError } = await supabase
    .from(tableName)
    .select('*')
    .eq('form_id', formId);

  if (fetchError) throw fetchError;

  const entitiesToDelete = (existingEntities || []).filter(
    (existing: any) => !validIds.includes(existing.id)
  );

  // Étape 2 : Supprimer les entités qui ne sont plus dans la liste
  if (entitiesToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from(tableName)
      .delete()
      .eq('form_id', formId)
      .not('id', 'in', `(${validIds.join(',')})`);

    if (deleteError) throw deleteError;
  }

  // Étape 3 : Upsert des nouvelles entités et des entités mises à jour
  try {
    const sanitizedEntities = entities.map((entity: any) => {
      const copy = { ...entity, form_id: formId };
      if (tableName === 'logic_rules') {
        // Remplacer les chaînes vides ou undefined par null pour éviter les erreurs de type UUID SQL
        if (!copy.target_field_id || copy.target_field_id === '') {
          copy.target_field_id = null;
        }
      }
      return copy;
    });

    const { error: upsertError } = await supabase
      .from(tableName)
      .upsert(sanitizedEntities);

    if (upsertError) throw upsertError;

    return entities;
  } catch (upsertError) {
    // Rollback : restaurer les entités supprimées en cas d'échec de l'upsert
    if (entitiesToDelete.length > 0) {
      try {
        await supabase
          .from(tableName)
          .insert(entitiesToDelete);
      } catch (rollbackError) {
        console.error(`Erreur lors du rollback des ${entityName}:`, rollbackError);
        // L'erreur de rollback ne doit pas masquer l'erreur originale
      }
    }
    throw upsertError;
  }
}

export async function updateForm(id: string, patch: Partial<Form>): Promise<Form | null> {
  const supabase = createClient();

  // Séparer les champs, logic_rules et workspace_id (non présent dans la BDD Supabase) du reste des données
  const { fields, logic_rules, workspace_id: _workspaceIdIgnored, ...formPatch } = patch;

  // Mettre à jour le formulaire principal
  const { data: form, error: formError } = await supabase
    .from('forms')
    .update({
      ...formPatch,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (formError) {
    if (formError.code === 'PGRST116') return null;
    throw formError;
  }

  // Synchroniser les champs avec gestion d'erreur et rollback
  const finalFields = await syncRelatedEntities(
    supabase,
    'fields',
    id,
    fields,
    'champs'
  );

  // Synchroniser les logic_rules avec gestion d'erreur et rollback
  const finalLogicRules = await syncRelatedEntities(
    supabase,
    'logic_rules',
    id,
    logic_rules,
    'règles logiques'
  );

  // Construire le résultat localement au lieu de recharger depuis la DB
  const updatedForm: Form = {
    ...form,
    fields: finalFields,
    logic_rules: finalLogicRules
  };

  notifyFormUpdated(id, updatedForm);
  return updatedForm;
}

export async function deleteForm(id: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from('forms')
    .delete()
    .eq('id', id);

  if (error) throw error;

  notifyFormDeleted(id);
  notifyFormsChanged();
}

/** Ajoute un champ à un formulaire et renvoie le formulaire à jour. */
export async function addField(
  formId: string,
  type: Field['type'],
  label = 'Nouvelle question',
  customField?: Field
): Promise<Form | null> {
  const supabase = createClient();

  const form = await getForm(formId);
  if (!form) return null;

  const fields = form.fields ?? [];
  const newField: Field = customField
    ? { ...customField, form_id: formId, field_order: fields.length }
    : {
        id: uuid(),
        form_id: formId,
        type,
        label: emptyMultilingual(label),
        description: emptyMultilingual(''),
        placeholder: emptyMultilingual(''),
        options:
          type === 'single_choice' || type === 'multiple_choice' || type === 'dropdown'
            ? [
                { id: uuid(), label: emptyMultilingual('') },
                { id: uuid(), label: emptyMultilingual('') }
              ]
            : type === 'matrix'
              ? [
                  { id: uuid(), label: emptyMultilingual('Pas du tout') },
                  { id: uuid(), label: emptyMultilingual('Plutôt non') },
                  { id: uuid(), label: emptyMultilingual('Neutre') },
                  { id: uuid(), label: emptyMultilingual('Plutôt oui') },
                  { id: uuid(), label: emptyMultilingual('Tout à fait') }
                ]
              : [],
        rows:
          type === 'matrix'
            ? [
                { id: uuid(), label: emptyMultilingual('Critère 1') },
                { id: uuid(), label: emptyMultilingual('Critère 2') },
                { id: uuid(), label: emptyMultilingual('Critère 3') }
              ]
            : undefined,
        required: form.require_all_by_default ?? false,
        field_order: fields.length,
        validation: type === 'matrix' ? { matrix_mode: 'single' } : {}
      };

  // INSERT atomique d'un seul champ
  const { error } = await supabase
    .from('fields')
    .insert([newField]);

  if (error) throw error;

  // Mettre à jour le formulaire avec un nouveau timestamp
  await supabase
    .from('forms')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', formId);

  // Retourner le formulaire à jour
  const updated = await getForm(formId);
  if (updated) notifyFormUpdated(formId, updated);
  return updated;
}

export async function updateField(formId: string, fieldId: string, patch: Partial<Field>): Promise<Form | null> {
  const supabase = createClient();

  // UPDATE atomique d'un seul champ
  const { error } = await supabase
    .from('fields')
    .update(patch)
    .eq('id', fieldId)
    .eq('form_id', formId);

  if (error) throw error;

  // Mettre à jour le formulaire avec un nouveau timestamp
  await supabase
    .from('forms')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', formId);

  // Retourner le formulaire à jour
  const updated = await getForm(formId);
  if (updated) notifyFormUpdated(formId, updated);
  return updated;
}

export async function deleteField(formId: string, fieldId: string): Promise<Form | null> {
  const supabase = createClient();

  const form = await getForm(formId);
  if (!form) return null;

  const fields = form.fields ?? [];
  const nextFields = fields
    .filter((f) => f.id !== fieldId)
    .map((f, i) => ({ ...f, field_order: i }));

  // Supprimer le champ de la base
  await supabase.from('fields').delete().eq('id', fieldId);

  // Mettre à jour l'ordre de tous les autres champs
  if (nextFields.length > 0) {
    const { error: upsertError } = await supabase
      .from('fields')
      .upsert(nextFields.map(f => ({ ...f, form_id: formId })));
    if (upsertError) throw upsertError;
  }

  // Mettre à jour le timestamp du formulaire
  await supabase
    .from('forms')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', formId);

  const updated = await getForm(formId);
  if (updated) notifyFormUpdated(formId, updated);
  return updated;
}

/** Réordonne les champs selon la liste d'IDs fournie. */
export async function reorderFields(formId: string, orderedIds: string[]): Promise<Form | null> {
  const supabase = createClient();

  // UPDATE atomique du field_order de chaque champ individuellement
  const updatePromises = orderedIds.map((fieldId, newOrder) =>
    supabase
      .from('fields')
      .update({ field_order: newOrder })
      .eq('id', fieldId)
      .eq('form_id', formId)
  );

  // Exécuter tous les updates en parallèle
  const results = await Promise.all(updatePromises);

  // Vérifier s'il y a des erreurs
  for (const result of results) {
    if (result.error) throw result.error;
  }

  // Mettre à jour le formulaire avec un nouveau timestamp
  await supabase
    .from('forms')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', formId);

  // Retourner le formulaire à jour
  const updated = await getForm(formId);
  if (updated) notifyFormUpdated(formId, updated);
  return updated;
}

/** Duplique un champ et l'insère juste après l'original. Renvoie l'ID du nouveau champ. */
export async function duplicateField(
  formId: string,
  fieldId: string,
  customField?: Field
): Promise<{ form: Form; newFieldId: string } | null> {
  const supabase = createClient();

  const form = await getForm(formId);
  if (!form) return null;

  const fields = form.fields ?? [];
  const idx = fields.findIndex((f) => f.id === fieldId);
  if (idx === -1) return null;

  const original = fields[idx];
  const newId = customField ? customField.id : uuid();
  const copy: Field = customField
    ? { ...customField, form_id: formId }
    : {
        ...original,
        id: newId,
        options: original.options.map((o) => ({ ...o, id: uuid() })),
        field_order: idx + 1
      };

  const nextFields = [...fields];
  nextFields.splice(idx + 1, 0, copy);
  
  // Re-indexer l'ordre de tous les champs
  const finalFields = nextFields.map((f, i) => ({ ...f, field_order: i }));

  // Insérer / mettre à jour tous les champs
  const { error: upsertError } = await supabase
    .from('fields')
    .upsert(finalFields.map(f => ({ ...f, form_id: formId })));

  if (upsertError) throw upsertError;

  // Mettre à jour le formulaire avec un nouveau timestamp
  await supabase
    .from('forms')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', formId);

  const updated = await getForm(formId);
  if (updated) notifyFormUpdated(formId, updated);
  return updated ? { form: updated, newFieldId: newId } : null;
}

/** Helper utilisé par OptionsEditor pour gérer les options d'un champ. */
export function newOptionId(): string {
  return uuid();
}

/**
 * Duplique un formulaire entier (nouveau ID, nouveau slug, statut brouillon).
 */
export async function cloneForm(formId: string, customTeamId?: string): Promise<Form | null> {
  const original = await getForm(formId);
  if (!original) return null;

  const user = await getCurrentUser();
  const now = new Date().toISOString();
  const supabase = createClient();

  let teamId = customTeamId;

  if (!teamId) {
    // Si aucun teamId n'est spécifié, utiliser celui du formulaire d'origine
    teamId = original.team_id;

    // Si le formulaire d'origine n'a pas de team_id, récupérer le team principal de l'utilisateur
    if (!teamId) {
      const { data: membership } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', user.id)
        .maybeSingle();
      teamId = membership?.team_id || user.id;
    }
  }

  const clonedData = {
    team_id: teamId,
    created_by: user.id,
    title: `${original.title} (copie)`,
    slug: uniqueSlug(`${original.title}-copie`),
    description: original.description,
    display_mode: original.display_mode,
    status: 'draft' as const,
    is_template: false,
    template_origin_id: original.id,
    theme: original.theme,
    access_type: original.access_type,
    access_password: original.access_password,
    languages: original.languages,
    default_language: original.default_language,
    published_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now
  };

  const { data: cloned, error } = await supabase
    .from('forms')
    .insert(clonedData)
    .select()
    .single();

  if (error) throw error;

  // Copier les champs
  if (original.fields && original.fields.length > 0) {
    const newFields = original.fields.map((f) => ({
      ...f,
      id: uuid(),
      form_id: cloned.id,
      options: f.options.map((o) => ({ ...o, id: uuid() }))
    }));

    const { error: fieldsError } = await supabase
      .from('fields')
      .insert(newFields);

    if (fieldsError) throw fieldsError;
  }

  // Copier les logic_rules
  if (original.logic_rules && original.logic_rules.length > 0) {
    const newRules = original.logic_rules.map((r) => ({
      ...r,
      id: uuid(),
      form_id: cloned.id
    }));

    const { error: rulesError } = await supabase
      .from('logic_rules')
      .insert(newRules);

    if (rulesError) throw rulesError;
  }

  const clonedForm = await getForm(cloned.id);
  notifyFormsChanged();
  notifyFormCreated();
  return clonedForm;
}

/** Archive un formulaire — passe le statut à `closed`. Réversible via `unarchiveForm`. */
export async function archiveForm(formId: string): Promise<Form | null> {
  return await updateForm(formId, { status: 'closed' });
}

/** Désarchive — repasse en brouillon. */
export async function unarchiveForm(formId: string): Promise<Form | null> {
  return await updateForm(formId, { status: 'draft' });
}

/**
 * Marque un formulaire comme modèle, ou l'inverse.
 */
export async function setAsTemplate(
  formId: string,
  isTemplate: boolean,
  scope: 'personal' | 'workspace' = 'personal'
): Promise<Form | null> {
  return await updateForm(formId, {
    is_template: isTemplate,
    scope: isTemplate ? scope : undefined
  });
}

// ============================================================================
// Logic rules (conditional display)
// ============================================================================

export async function listLogicRules(formId: string, sourceFieldId?: string): Promise<LogicRule[]> {
  const form = await getForm(formId);
  if (!form) return [];

  const rules = form.logic_rules ?? [];
  return sourceFieldId ? rules.filter((r) => r.conditions.some(c => c.source_field_id === sourceFieldId)) : rules;
}

export async function addLogicRule(
  formId: string,
  rule: Omit<LogicRule, 'id' | 'form_id'>
): Promise<Form | null> {
  const form = await getForm(formId);
  if (!form) return null;

  const newRule: LogicRule = {
    ...rule,
    id: uuid(),
    form_id: formId
  };

  return await updateForm(formId, { logic_rules: [...(form.logic_rules ?? []), newRule] });
}

export async function updateLogicRule(
  formId: string,
  ruleId: string,
  patch: Partial<LogicRule>
): Promise<Form | null> {
  const form = await getForm(formId);
  if (!form) return null;

  const next = (form.logic_rules ?? []).map((r) => (r.id === ruleId ? { ...r, ...patch } : r));
  return await updateForm(formId, { logic_rules: next });
}

export async function deleteLogicRule(formId: string, ruleId: string): Promise<Form | null> {
  const form = await getForm(formId);
  if (!form) return null;

  const next = (form.logic_rules ?? []).filter((r) => r.id !== ruleId);
  return await updateForm(formId, { logic_rules: next });
}

// ============================================================================
// Workspaces (Teams) & Member Management
// ============================================================================

import type { Team } from '@/types';

export async function createTeam(name: string): Promise<Team> {
  const supabase = createClient();
  const user = await getCurrentUser();
  const teamId = uuid();

  // 1. Créer la team (sans select(), pour éviter que le RLS de SELECT ne bloque avant que le membre ne soit inséré !)
  const { error: teamError } = await supabase
    .from('teams')
    .insert({ id: teamId, name, plan: 'free' });

  if (teamError) throw teamError;

  // 2. Associer l'utilisateur comme admin
  const { error: memberError } = await supabase
    .from('team_members')
    .insert({
      user_id: user.id,
      team_id: teamId,
      role: 'admin'
    });

  if (memberError) {
    // Rollback manuel de l'équipe si l'association de membre a échoué
    await supabase.from('teams').delete().eq('id', teamId);
    throw memberError;
  }

  // 3. Retourner l'objet team construit localement pour éviter le bug RLS de lecture côté client
  const team: Team = {
    id: teamId,
    name,
    plan: 'free',
    created_at: new Date().toISOString()
  };

  // 4. Définir le cookie actif sur le client
  if (typeof document !== 'undefined') {
    document.cookie = `papyrus:active-team-id=${team.id}; path=/; max-age=31536000; SameSite=Lax`;
  }

  return team;
}

export async function updateTeamName(teamId: string, name: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('teams')
    .update({ name })
    .eq('id', teamId);

  if (error) throw error;
}

export async function listTeamMembers(teamId: string): Promise<any[]> {
  const res = await fetch(`/api/members?teamId=${teamId}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Erreur lors de la récupération des membres');
  }
  return await res.json();
}

export async function addTeamMember(teamId: string, email: string, role: 'admin' | 'member' | 'reader' = 'member'): Promise<void> {
  const res = await fetch('/api/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, email, role })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Erreur lors de l'invitation");
  }
}

export async function updateTeamMemberRole(teamId: string, userId: string, role: 'admin' | 'member' | 'reader'): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('team_members')
    .update({ role })
    .eq('team_id', teamId)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function deleteTeamMember(teamId: string, userId: string): Promise<void> {
  const res = await fetch('/api/members', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, userId })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Erreur lors de la suppression du membre');
  }
}

/**
 * Remappage des identifiants de champs cachés dans les objets JSON.
 *
 * `importForm` renumérote les champs, mais trois objets embarquent eux aussi des
 * `field_id` et étaient recopiés tels quels : ils pointaient donc vers les champs
 * du formulaire d'origine. Silencieux, et d'autant plus vicieux que rien
 * n'échoue — le formulaire importé fonctionne, mais son anti-doublon surveille
 * un champ qui appartient à un autre formulaire.
 */
type IdMap = Record<string, string>;

const mapId = (id: string | undefined, m: IdMap) => (id ? (m[id] ?? id) : id);

function remapSettings(settings: FormSettings, m: IdMap): FormSettings {
  return { ...settings, duplicate_field_id: mapId(settings.duplicate_field_id, m) };
}

function remapNotifications(n: NotificationSettings, m: IdMap): NotificationSettings {
  if (!n.respondent) return n;
  return {
    ...n,
    respondent: { ...n.respondent, to_field_id: mapId(n.respondent.to_field_id, m) ?? '' }
  };
}

function remapTheme(theme: FormTheme, m: IdMap): FormTheme {
  const dashboard = theme.dashboard_config;
  if (!dashboard) return theme;

  return {
    ...theme,
    dashboard_config: {
      ...dashboard,
      chart_order: dashboard.chart_order?.map((id) => mapId(id, m) as string),
      deleted_charts: dashboard.deleted_charts?.map((id) => mapId(id, m) as string),
      chart_layout: dashboard.chart_layout?.map((item) => ({
        ...item,
        field_id: mapId(item.field_id, m) as string
      })),
      chart_titles: dashboard.chart_titles
        ? Object.fromEntries(
            Object.entries(dashboard.chart_titles).map(([key, value]) => [
              mapId(key, m) as string,
              value
            ])
          )
        : undefined
    }
  };
}

const DEFAULT_IMPORT_THEME: FormTheme = {
  bg: '#EFF9FE',
  accent: '#052139',
  font: 'Aktiv Grotesk',
  banner_url: null,
  dark_mode: false
};

/**
 * Importe un formulaire JSON dans Supabase en remappant tous les identifiants
 */
export async function importForm(
  formJson: Partial<Form> & { fields?: Field[]; logic_rules?: LogicRule[] },
  customTeamId?: string
): Promise<Form> {
  const supabase = createClient();
  const user = await getCurrentUser();
  const now = new Date().toISOString();
  const newFormId = uuid();
  
  const teamId = customTeamId || getActiveTeamId() || user.id;
  
  // 1. Remap fields and options/rows
  const fieldIdMap: Record<string, string> = {};
  const optionIdMap: Record<string, string> = {};
  
  const mappedFields: Field[] = (formJson.fields || []).map((field, index) => {
    const newFieldId = uuid();
    fieldIdMap[field.id] = newFieldId;
    
    const mappedOptions = (field.options || []).map(opt => {
      const newOptId = uuid();
      optionIdMap[opt.id] = newOptId;
      return {
        ...opt,
        id: newOptId,
        label: normalizeMultilingual(opt.label)
      };
    });
    
    const mappedRows = field.rows ? field.rows.map(row => {
      const newRowId = uuid();
      optionIdMap[row.id] = newRowId;
      return {
        ...row,
        id: newRowId,
        label: normalizeMultilingual(row.label)
      };
    }) : undefined;

    // Les sous-questions étaient propagées par spread, identifiants compris. Les
    // colonnes de réponse suivent le format `[field_id]__[option]__[subfield_id]`
    // (lib/submission-columns.ts) : deux formulaires partageant un identifiant de
    // sous-question produiraient des colonnes qui se marchent dessus.
    const mappedSubfields = field.subfields?.map((sf) => ({
      ...sf,
      id: uuid(),
      options: (sf.options ?? []).map((o) => ({ ...o, id: uuid() })),
      rows: sf.rows?.map((r) => ({ ...r, id: uuid() }))
    }));

    return {
      ...field,
      id: newFieldId,
      form_id: newFormId,
      label: normalizeMultilingual(field.label),
      description: normalizeMultilingual(field.description),
      placeholder: normalizeMultilingual(field.placeholder),
      required: typeof field.required === 'boolean' ? field.required : false,
      validation: field.validation || {},
      options: mappedOptions,
      rows: mappedRows,
      ...(mappedSubfields ? { subfields: mappedSubfields } : {}),
      field_order: index
    };
  });
  
  // 2. Remap logic rules
  const mappedRules: LogicRule[] = (formJson.logic_rules || []).map(rule => {
    const newRuleId = uuid();
    
    const mappedConditions = (rule.conditions || []).map(cond => {
      let newConditionValue = cond.value;
      if (optionIdMap[cond.value]) {
        newConditionValue = optionIdMap[cond.value];
      }
      return {
        source_field_id: fieldIdMap[cond.source_field_id] || cond.source_field_id,
        operator: cond.operator,
        value: newConditionValue
      };
    });
    
    return {
      ...rule,
      id: newRuleId,
      form_id: newFormId,
      conditions: mappedConditions,
      conditions_operator: rule.conditions_operator || 'AND',
      action_type: rule.action_type,
      target_field_id: rule.target_field_id ? (fieldIdMap[rule.target_field_id] || rule.target_field_id) : null,
      rule_order: rule.rule_order
    } as any;
  });
  
  // 3. Insert form
  const formData = {
    id: newFormId,
    team_id: teamId,
    created_by: user.id,
    title: formJson.title || 'Formulaire importé',
    slug: uniqueSlug(formJson.title || 'Formulaire importé'),
    description: formJson.description || '',
    // Les modèles du catalogue sont paginés par `section_break` : 'sections' est
    // le mode qui les rend correctement, 'scroll' aplatissait toutes les pages.
    display_mode: formJson.display_mode || 'sections',
    status: 'draft' as const,
    is_template: false,
    // Volontairement `null` en dur, jamais `formJson.template_origin_id`.
    // La colonne est un `uuid references papyrus.forms(id)` ; l'identifiant d'un
    // modèle de catalogue est la chaîne `tpl-mooove-…`, qui n'est ni un uuid ni
    // une ligne en base. Y écrire l'origine faisait échouer tout clonage de
    // modèle global sur `22P02 invalid input syntax for type uuid`.
    // L'origine est conservée dans `settings.template_origin_slug`.
    template_origin_id: null,
    theme: remapTheme(formJson.theme ?? DEFAULT_IMPORT_THEME, fieldIdMap),
    access_type: formJson.access_type || 'public',
    access_password: formJson.access_password || null,
    languages: formJson.languages || ['fr'],
    default_language: formJson.default_language || 'fr',
    save_and_resume: formJson.save_and_resume ?? true,
    unique_email: formJson.unique_email ?? false,
    scoring_enabled: typeof formJson.scoring_enabled === 'boolean' ? formJson.scoring_enabled : false,
    show_score_to_respondent: typeof formJson.show_score_to_respondent === 'boolean' ? formJson.show_score_to_respondent : false,
    settings: remapSettings(formJson.settings ?? {}, fieldIdMap),
    notification_settings: remapNotifications(formJson.notification_settings ?? {}, fieldIdMap),
    published_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now
  };
  
  const { data: _form, error: formError } = await supabase
    .from('forms')
    .insert(formData)
    .select()
    .single();
    
  if (formError) throw formError;
  
  // 4. Insert fields
  if (mappedFields.length > 0) {
    const { error: fieldsError } = await supabase
      .from('fields')
      .insert(mappedFields);
    if (fieldsError) {
      await supabase.from('forms').delete().eq('id', newFormId);
      throw fieldsError;
    }
  }
  
  // 5. Insert rules
  if (mappedRules.length > 0) {
    const { error: rulesError } = await supabase
      .from('logic_rules')
      .insert(mappedRules);
    if (rulesError) {
      await supabase.from('fields').delete().eq('form_id', newFormId);
      await supabase.from('forms').delete().eq('id', newFormId);
      throw rulesError;
    }
  }
  
  const importedForm = await getForm(newFormId);
  notifyFormsChanged();
  notifyFormCreated();
  
  if (!importedForm) throw new Error('Failed to retrieve imported form');
  return importedForm;
}