'use client';

import type {
  Field,
  FieldCalc,
  Form,
  Section,
  FormSettings,
  FormTheme,
  LogicRule,
  MultilingualText,
  NotificationSettings,
  VisibilityRule
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

/**
 * Écrit le cookie d'espace actif, lu aussi bien par le client que par la coquille
 * du tableau de bord (`app/(dashboard)/layout.tsx`).
 */
export function setActiveTeamId(teamId: string): void {
  if (typeof document === 'undefined' || !teamId) return;
  document.cookie = `papyrus:active-team-id=${teamId}; path=/; max-age=31536000; SameSite=Lax`;
}

/** Expose la lecture du cookie aux composants. */
export function readActiveTeamId(): string | null {
  return getActiveTeamId();
}

/**
 * Résout l'espace de travail dans lequel écrire un nouveau formulaire.
 *
 * Le repli historique était `user.id`. Il ne pouvait jamais fonctionner :
 * `papyrus.teams.id` est un `gen_random_uuid()`, sans rapport avec l'identifiant
 * du compte. Un `team_id` égal à `user.id` échoue à la fois sur la policy
 * `forms_insert` (`is_team_member(team_id)` est faux) et sur la clé étrangère
 * `forms.team_id references papyrus.teams(id)`.
 *
 * Le cookie `papyrus:active-team-id` n'est écrit que par le sélecteur d'espace :
 * un compte qui vient d'être créé ne l'a pas encore. Sur ce compte, tout chemin
 * de création qui ne passe pas par le sélecteur — « Utiliser » un modèle, en
 * particulier — tombait donc sur le repli et échouait, quel que soit le modèle.
 * On interroge maintenant l'appartenance réelle plutôt que de deviner.
 */
async function resolveTeamId(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  customTeamId?: string
): Promise<string> {
  if (customTeamId) return customTeamId;

  const fromCookie = getActiveTeamId();
  if (fromCookie) return fromCookie;

  // Même forme de requête que `listForms` : filtrée sur `user_id`, elle ne
  // déclenche pas la récursion de la policy `team_members`.
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error resolving active team:', error);
    throw new Error("Impossible de déterminer votre espace de travail.");
  }

  if (!data?.team_id) {
    throw new Error("Aucun espace de travail disponible pour ce compte.");
  }

  return data.team_id;
}

/**
 * Résout le projet dans lequel écrire un nouveau formulaire.
 *
 * Tout formulaire réel appartient à un projet — la contrainte
 * `forms_project_required` le garantit en base. Mais les chemins de création
 * hérités (« Nouveau formulaire » depuis la barre latérale, import d'un JSON,
 * duplication) ne connaissent qu'un espace de travail. Plutôt que de les faire
 * échouer, on retombe sur le projet le plus récemment modifié de cet espace, et
 * on en crée un si l'espace n'en a aucun.
 *
 * Créer le projet ici plutôt que refuser l'écriture est délibéré : un compte tout
 * neuf doit pouvoir créer un formulaire sans avoir d'abord compris ce qu'est un
 * projet.
 */
async function resolveProjectId(
  supabase: ReturnType<typeof createClient>,
  teamId: string,
  userId: string,
  customProjectId?: string
): Promise<string> {
  if (customProjectId) return customProjectId;

  const { data: existing, error } = await supabase
    .from('projects')
    .select('id')
    .eq('team_id', teamId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error resolving project:', error);
    throw new Error("Impossible de déterminer le projet de destination.");
  }

  if (existing?.id) return existing.id as string;

  const { data: created, error: createError } = await supabase
    .from('projects')
    .insert({ team_id: teamId, created_by: userId, name: 'Mes formulaires' })
    .select('id')
    .single();

  if (createError) {
    console.error('Error creating default project:', createError);
    throw new Error("Impossible de créer un projet pour ce formulaire.");
  }

  return created.id as string;
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
      sections(*),
      fields(*),
      logic_rules(*)
    `)
    .in('team_id', teamIds)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching forms:', error);
    throw error;
  }

  return (forms ?? []).map(normalizeForm);
}

export async function getForm(id: string): Promise<Form | null> {
  const supabase = createClient();

  // Une seule requête avec nested selects pour éviter N+1
  const { data: form, error } = await supabase
    .from('forms')
    .select(`
      *,
      sections(*),
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

  return normalizeForm(form);
}

export async function createForm(
  title = 'Nouveau formulaire',
  customTeamId?: string,
  customProjectId?: string
): Promise<Form> {
  const supabase = createClient();
  const user = await getCurrentUser();
  const now = new Date().toISOString();

  // customTeamId, sinon le cookie d'espace actif, sinon l'appartenance en base.
  const teamId = await resolveTeamId(supabase, user.id, customTeamId);
  const projectId = await resolveProjectId(supabase, teamId, user.id, customProjectId);

  const formData = {
    team_id: teamId,
    project_id: projectId,
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

  // Tout formulaire possède au moins une section : `fields.section_id` est
  // `not null`, donc sans elle la première question serait refusée à l'écriture.
  // Elle est sans titre — le formulaire commence par ses questions tant que
  // personne n'a décidé du contraire.
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .insert({ form_id: form.id, section_order: 0 })
    .select()
    .single();

  if (sectionError) throw sectionError;

  notifyFormsChanged();
  notifyFormCreated();

  return {
    ...form,
    sections: [{ ...(section as Section), fields: [] }],
    fields: [],
    logic_rules: [],
    save_and_resume: true,
    unique_email: true
  };
}

/**
 * Lignes prêtes pour PostgREST.
 *
 * `insert()` et `upsert()` de postgrest-js construisent la liste des colonnes à
 * partir de l'**union des clés de toutes les lignes** envoyées. Pour une ligne à
 * laquelle une de ces colonnes manque, PostgREST écrit `NULL` — et non la valeur
 * par défaut de la colonne : l'en-tête `Prefer: missing=default` n'est posé que
 * si l'appelant passe `defaultToNull: false`, qui n'est pas le défaut.
 *
 * Deux conséquences, invisibles à la lecture du code appelant :
 *
 * - `Object.keys()` retient une clé dont la valeur vaut `undefined`, alors que
 *   `JSON.stringify` la retire du corps de la requête. Un champ construit avec
 *   `rows: undefined` — ce que fait le builder pour tout type autre que
 *   `matrix` — inscrit donc `rows` dans la liste des colonnes sans fournir de
 *   valeur. D'où un `NULL` dans `rows jsonb not null` : ajouter un champ à un
 *   formulaire échouait, quel que soit le type de champ.
 * - Un lot mêlant des lignes relues de la base (toutes les colonnes) et des
 *   lignes fraîchement construites (un sous-ensemble) écrit `NULL` dans les
 *   colonnes que les secondes ne portent pas — `subfields`, `style`,
 *   `hidden_by_default`, toutes `not null`.
 *
 * D'où ces deux fonctions : toute ligne envoyée porte exactement les mêmes clés,
 * explicitement remplies. `created_at` en est volontairement absent — la base le
 * remplit à l'insertion et le conserve lors d'un upsert.
 */
// `type` reste obligatoire : la colonne est `not null` et sous contrainte
// `check`, une ligne qui l'omettrait serait refusée à l'écriture.
type FieldRow = Omit<Partial<Field>, 'type'> & {
  id: string;
  type: Field['type'];
  hidden_by_default?: boolean;
};

/**
 * Section de repli quand l'appelant n'en fournit pas.
 *
 * `fields.section_id` est `not null` : une ligne sans section est refusée à
 * l'écriture. Plutôt que de propager la contrainte jusqu'à chaque appelant, on
 * résout ici la première section du formulaire — il en a toujours au moins une.
 */
async function resolveSectionId(
  supabase: ReturnType<typeof createClient>,
  formId: string,
  preferred?: string
): Promise<string> {
  if (preferred) return preferred;

  const { data, error } = await supabase
    .from('sections')
    .select('id')
    .eq('form_id', formId)
    .order('section_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (data?.id) return data.id as string;

  // Un formulaire sans section ne devrait pas exister ; s'il s'en présente un,
  // on le répare plutôt que de refuser l'écriture.
  const { data: created, error: createError } = await supabase
    .from('sections')
    .insert({ form_id: formId, section_order: 0 })
    .select('id')
    .single();

  if (createError) throw createError;
  return created.id as string;
}

/**
 * Remet les champs dans l'ordre de lecture : sections dans l'ordre, puis champs
 * dans l'ordre à l'intérieur de chacune.
 *
 * `field_order` est relatif à sa section depuis la migration 004 : trier les
 * champs sur ce seul critère entrelacerait les sections, et la barre de
 * progression comme les colonnes d'export s'en trouveraient fausses.
 */
function orderFields(fields: Field[], sections: Section[]): Field[] {
  const rank = new Map(sections.map((section) => [section.id, section.section_order]));

  return [...fields].sort((a, b) => {
    const sectionDelta =
      (rank.get(a.section_id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.section_id) ?? Number.MAX_SAFE_INTEGER);
    return sectionDelta !== 0 ? sectionDelta : a.field_order - b.field_order;
  });
}

/** Normalise la réponse PostgREST d'un formulaire et de ses relations. */
function normalizeForm(row: Record<string, unknown>): Form {
  const sections = ((row.sections as Section[]) ?? []).sort(
    (a, b) => a.section_order - b.section_order
  );
  const fields = orderFields((row.fields as Field[]) ?? [], sections);
  const logicRules = ((row.logic_rules as LogicRule[]) ?? []).sort(
    (a, b) => a.rule_order - b.rule_order
  );

  return {
    ...(row as unknown as Form),
    sections: sections.map((section) => ({
      ...section,
      fields: fields.filter((field) => field.section_id === section.id)
    })),
    fields,
    logic_rules: logicRules
  };
}

/**
 * Réécrit les identifiants de champ cités par un verrou de visibilité.
 *
 * Un verrou copié tel quel continue de désigner les questions du formulaire
 * d'ORIGINE, qui existent toujours : la copie hérite d'un verrou branché sur un
 * autre formulaire, qui ne s'ouvre jamais. Sans erreur, et sans que rien ne le
 * laisse voir dans l'éditeur — c'est le même piège que celui des règles de
 * logique.
 */
export function remapVisibility(
  visibility: VisibilityRule | undefined | null,
  fieldIdMap: Record<string, string>,
  /** Renseignée seulement quand les identifiants d'option changent aussi — à
   *  l'import. Une condition désigne une option par son identifiant. */
  optionIdMap: Record<string, string> = {}
): VisibilityRule | undefined {
  if (!visibility?.conditions?.length) return undefined;

  return {
    operator: visibility.operator ?? 'AND',
    conditions: visibility.conditions.map((condition) => ({
      ...condition,
      source_field_id: fieldIdMap[condition.source_field_id] ?? condition.source_field_id,
      value: optionIdMap[condition.value] ?? condition.value
    }))
  };
}

/** Même correspondance, pour les champs sources d'un champ calculé. */
export function remapCalc(
  calc: FieldCalc | undefined | null,
  fieldIdMap: Record<string, string>
): FieldCalc | null {
  if (!calc) return null;
  return {
    ...calc,
    sources: (calc.sources ?? []).map((source) => fieldIdMap[source] ?? source)
  };
}

export function toFieldRow(field: FieldRow, formId: string) {
  return {
    id: field.id,
    form_id: formId,
    section_id: field.section_id,
    type: field.type,
    label: field.label ?? {},
    description: field.description ?? {},
    placeholder: field.placeholder ?? {},
    options: field.options ?? [],
    rows: field.rows ?? [],
    subfields: field.subfields ?? [],
    style: field.style ?? {},
    layout_width: field.layout_width ?? 'full',
    required: field.required ?? false,
    hidden_by_default: field.hidden_by_default ?? false,
    field_order: field.field_order ?? 0,
    validation: field.validation ?? {},
    visibility: field.visibility ?? {},
    // Ces deux colonnes sont nullables : seuls `repeater` et `calculated` les
    // renseignent, et un objet vide y serait pris pour une configuration.
    repeater: field.repeater ?? null,
    calc: field.calc ?? null
  };
}

type LogicRuleRow = Partial<LogicRule> & { id: string };

export function toLogicRuleRow(rule: LogicRuleRow, formId: string) {
  return {
    id: rule.id,
    form_id: formId,
    conditions: rule.conditions ?? [],
    conditions_operator: rule.conditions_operator ?? 'AND',
    action_type: rule.action_type ?? null,
    // La colonne est un uuid : une chaîne vide y déclencherait un 22P02.
    target_field_id: rule.target_field_id || null,
    target_section_id: rule.target_section_id || null,
    rule_order: rule.rule_order ?? 0
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
    // Annotation volontaire : sans elle, l'union des trois branches fait échouer
    // l'inférence de `upsert()`, qui aligne toutes les lignes sur la première.
    const sanitizedEntities: Record<string, unknown>[] =
      tableName === 'fields'
        ? (entities as unknown as FieldRow[]).map((f) => toFieldRow(f, formId))
        : tableName === 'logic_rules'
          ? (entities as unknown as LogicRuleRow[]).map((r) => toLogicRuleRow(r, formId))
          : entities.map((entity) => ({ ...entity, form_id: formId }));

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

  // Séparer les relations et `workspace_id` (qui n'est pas une colonne) du reste.
  const {
    fields,
    logic_rules,
    sections,
    workspace_id: _workspaceIdIgnored,
    ...formPatch
  } = patch;

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

  /*
   * Les sections sont mises à jour, jamais synchronisées par différence.
   *
   * `syncRelatedEntities` supprime ce qui manque à la liste reçue. Appliqué aux
   * sections, un enregistrement automatique parti avec une liste incomplète —
   * un état intermédiaire, une réponse arrivée dans le désordre — supprimerait
   * une section, et la cascade emporterait toutes ses questions avec elle.
   * Supprimer une section est une action délibérée : elle passe par
   * `deleteSection`, et par nulle part ailleurs.
   */
  if (sections && sections.length > 0) {
    await Promise.all(
      sections.map((section) =>
        supabase
          .from('sections')
          .update({
            title: section.title,
            description: section.description,
            section_order: section.section_order,
            visibility: section.visibility ?? {},
            hidden: section.hidden ?? false
          })
          .eq('id', section.id)
          .eq('form_id', id)
      )
    );
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
    sections,
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
  customField?: Field,
  sectionId?: string
): Promise<Form | null> {
  const supabase = createClient();

  const form = await getForm(formId);
  if (!form) return null;

  // Sans section explicite, la question rejoint la dernière — c'est là que
  // regarde quelqu'un qui vient d'ajouter la précédente.
  const targetSectionId = await resolveSectionId(
    supabase,
    formId,
    sectionId ?? customField?.section_id ?? form.sections?.[form.sections.length - 1]?.id
  );

  // `field_order` est relatif à la section : le rang se compte parmi ses
  // champs, pas parmi ceux du formulaire entier.
  const fields = (form.fields ?? []).filter((f) => f.section_id === targetSectionId);
  const newField: Field = customField
    ? { ...customField, form_id: formId, section_id: targetSectionId, field_order: fields.length }
    : {
        id: uuid(),
        form_id: formId,
        section_id: targetSectionId,
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
    .insert([toFieldRow(newField, formId)]);

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
      .upsert(nextFields.map((f) => toFieldRow(f, formId)));
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
    .upsert(finalFields.map((f) => toFieldRow(f, formId)));

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
export async function cloneForm(
  formId: string,
  customTeamId?: string,
  customProjectId?: string
): Promise<Form | null> {
  const original = await getForm(formId);
  if (!original) return null;

  const user = await getCurrentUser();
  const now = new Date().toISOString();
  const supabase = createClient();

  // Sans espace explicite, une copie reste dans l'espace du formulaire d'origine.
  // Le repli interrogeait `team_members` avec `maybeSingle()`, qui échoue dès que
  // le compte appartient à plusieurs espaces, puis retombait sur `user.id`.
  const teamId =
    customTeamId || original.team_id || (await resolveTeamId(supabase, user.id));

  // Sans projet explicite, une copie reste dans le projet de l'original — sauf
  // si la copie change d'espace de travail, auquel cas le projet d'origine n'y
  // existe pas et la résolution retombe sur un projet de l'espace cible.
  const projectId = await resolveProjectId(
    supabase,
    teamId,
    user.id,
    customProjectId ?? (teamId === original.team_id ? (original.project_id ?? undefined) : undefined)
  );

  const clonedData = {
    team_id: teamId,
    project_id: projectId,
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

  // Les identifiants des champs sont attribués AVANT toute insertion, parce que
  // trois choses y font référence et que deux d'entre elles partent en base
  // avant les champs eux-mêmes : le verrou de visibilité d'une section, celui
  // d'un champ — qui peut citer une question placée plus bas — et les sources
  // d'un champ calculé. Construire la table de correspondance au fil de
  // l'insertion laisserait ces trois-là pointer vers le formulaire d'origine.
  const fieldIdMap: Record<string, string> = {};
  for (const field of original.fields ?? []) fieldIdMap[field.id] = uuid();

  // Copier les sections d'abord : les champs y font référence.
  const sectionIdMap: Record<string, string> = {};
  const originalSections = [...(original.sections ?? [])].sort(
    (a, b) => a.section_order - b.section_order
  );

  const clonedSections = (
    originalSections.length > 0
      ? originalSections
      : [{ id: '__implicite__', title: {}, description: {}, section_order: 0 }]
  ).map((section, index) => {
    const newId = uuid();
    sectionIdMap[section.id] = newId;
    return {
      id: newId,
      form_id: cloned.id,
      title: section.title ?? {},
      description: section.description ?? {},
      section_order: index,
      visibility: remapVisibility(
        (section as Partial<Section>).visibility,
        fieldIdMap
      ),
      hidden: (section as Partial<Section>).hidden ?? false
    };
  });

  const { error: sectionsError } = await supabase.from('sections').insert(clonedSections);
  if (sectionsError) throw sectionsError;

  const fallbackSectionId = clonedSections[0].id;

  // Copier les champs.
  //
  // Les identifiants d'option sont conservés, alors qu'ils étaient auparavant
  // régénérés. Une condition logique désigne une option par son identifiant :
  // les renouveler cassait silencieusement toute la logique du formulaire copié.
  // Ils n'ont besoin d'être uniques qu'au sein de leur champ, et le champ, lui,
  // reçoit bien un nouvel identifiant.
  if (original.fields && original.fields.length > 0) {
    const newFields = original.fields.map((f) => ({
      ...f,
      id: fieldIdMap[f.id],
      form_id: cloned.id,
      section_id: sectionIdMap[f.section_id] ?? fallbackSectionId,
      visibility: remapVisibility(f.visibility, fieldIdMap),
      calc: remapCalc(f.calc, fieldIdMap) ?? undefined
    }));

    const { error: fieldsError } = await supabase
      .from('fields')
      .insert(newFields.map((f) => toFieldRow(f, cloned.id)));

    if (fieldsError) throw fieldsError;
  }

  // Copier les règles logiques, cibles et sources remappées.
  //
  // Elles étaient copiées telles quelles : leurs `target_field_id` et
  // `source_field_id` continuaient donc de désigner les champs de l'ORIGINAL,
  // qui existent toujours. La copie héritait d'une logique branchée sur un autre
  // formulaire — sans erreur, et sans que rien ne le laisse voir dans l'éditeur.
  if (original.logic_rules && original.logic_rules.length > 0) {
    const newRules = original.logic_rules.map((r) => ({
      ...r,
      id: uuid(),
      form_id: cloned.id,
      conditions: (r.conditions ?? []).map((condition) => ({
        ...condition,
        source_field_id: fieldIdMap[condition.source_field_id] ?? condition.source_field_id
      })),
      target_field_id: r.target_field_id ? (fieldIdMap[r.target_field_id] ?? null) : null,
      target_section_id: r.target_section_id ? (sectionIdMap[r.target_section_id] ?? null) : null
    }));

    const { error: rulesError } = await supabase
      .from('logic_rules')
      .insert(newRules.map((r) => toLogicRuleRow(r, cloned.id)));

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
// Sections
// ============================================================================

/** Ajoute une section vide à la fin du formulaire. */
export async function addSection(formId: string, title = ''): Promise<Form | null> {
  const supabase = createClient();

  const form = await getForm(formId);
  if (!form) return null;

  const { error } = await supabase.from('sections').insert({
    form_id: formId,
    title: title ? emptyMultilingual(title) : {},
    section_order: (form.sections ?? []).length
  });

  if (error) throw error;

  await touchForm(supabase, formId);
  const updated = await getForm(formId);
  if (updated) notifyFormUpdated(formId, updated);
  return updated;
}

export async function updateSection(
  formId: string,
  sectionId: string,
  patch: Partial<Pick<Section, 'title' | 'description' | 'section_order' | 'visibility' | 'hidden'>>
): Promise<Form | null> {
  const supabase = createClient();

  const { error } = await supabase
    .from('sections')
    .update(patch)
    .eq('id', sectionId)
    .eq('form_id', formId);

  if (error) throw error;

  await touchForm(supabase, formId);
  const updated = await getForm(formId);
  if (updated) notifyFormUpdated(formId, updated);
  return updated;
}

/**
 * Supprime une section — et, par cascade en base, les questions qu'elle
 * contient.
 *
 * La dernière section d'un formulaire ne peut pas être supprimée : `section_id`
 * est `not null`, un formulaire sans section n'accepterait plus aucune question.
 */
export async function deleteSection(formId: string, sectionId: string): Promise<Form | null> {
  const supabase = createClient();

  const form = await getForm(formId);
  if (!form) return null;

  const sections = form.sections ?? [];
  if (sections.length <= 1) {
    throw new Error('Un formulaire doit garder au moins une section.');
  }

  const { error } = await supabase
    .from('sections')
    .delete()
    .eq('id', sectionId)
    .eq('form_id', formId);

  if (error) throw error;

  // Renumérote ce qui reste, pour que l'ordre n'ait pas de trou.
  const remaining = sections.filter((section) => section.id !== sectionId);
  await Promise.all(
    remaining.map((section, index) =>
      supabase.from('sections').update({ section_order: index }).eq('id', section.id)
    )
  );

  await touchForm(supabase, formId);
  const updated = await getForm(formId);
  if (updated) notifyFormUpdated(formId, updated);
  return updated;
}

/** Réordonne les sections d'un formulaire selon la liste d'identifiants fournie. */
export async function reorderSections(formId: string, orderedIds: string[]): Promise<Form | null> {
  const supabase = createClient();

  await Promise.all(
    orderedIds.map((sectionId, index) =>
      supabase
        .from('sections')
        .update({ section_order: index })
        .eq('id', sectionId)
        .eq('form_id', formId)
    )
  );

  await touchForm(supabase, formId);
  const updated = await getForm(formId);
  if (updated) notifyFormUpdated(formId, updated);
  return updated;
}

/**
 * Déplace un champ vers une section, à la position voulue.
 *
 * Les deux sections concernées sont renumérotées : `field_order` est relatif à
 * la section, donc laisser un trou dans celle d'origine ou un doublon dans celle
 * d'arrivée suffirait à rendre l'ordre d'affichage arbitraire.
 */
export async function moveFieldToSection(
  formId: string,
  fieldId: string,
  targetSectionId: string,
  targetIndex: number
): Promise<Form | null> {
  const supabase = createClient();

  const form = await getForm(formId);
  if (!form) return null;

  const moved = (form.fields ?? []).find((field) => field.id === fieldId);
  if (!moved) return form;

  const sourceSectionId = moved.section_id;

  const target = (form.fields ?? [])
    .filter((field) => field.section_id === targetSectionId && field.id !== fieldId)
    .sort((a, b) => a.field_order - b.field_order);
  target.splice(Math.max(0, Math.min(targetIndex, target.length)), 0, moved);

  const updates = target.map((field, index) =>
    supabase
      .from('fields')
      .update({ section_id: targetSectionId, field_order: index })
      .eq('id', field.id)
  );

  if (sourceSectionId !== targetSectionId) {
    const source = (form.fields ?? [])
      .filter((field) => field.section_id === sourceSectionId && field.id !== fieldId)
      .sort((a, b) => a.field_order - b.field_order);
    updates.push(
      ...source.map((field, index) =>
        supabase.from('fields').update({ field_order: index }).eq('id', field.id)
      )
    );
  }

  await Promise.all(updates);

  await touchForm(supabase, formId);
  const updated = await getForm(formId);
  if (updated) notifyFormUpdated(formId, updated);
  return updated;
}

/** Rafraîchit `updated_at` — le formulaire a changé même si sa ligne, elle, non. */
async function touchForm(
  supabase: ReturnType<typeof createClient>,
  formId: string
): Promise<void> {
  await supabase
    .from('forms')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', formId);
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
  customTeamId?: string,
  customProjectId?: string
): Promise<Form> {
  const supabase = createClient();
  const user = await getCurrentUser();
  const now = new Date().toISOString();
  const newFormId = uuid();

  const teamId = await resolveTeamId(supabase, user.id, customTeamId);
  const projectId = await resolveProjectId(supabase, teamId, user.id, customProjectId);

  /**
   * Sections d'origine → sections créées.
   *
   * Un modèle du catalogue porte des identifiants textuels
   * (`tpl-mooove-x-section-0`) : la colonne est un uuid, il faut donc en
   * fabriquer de vrais. Une source sans section — un JSON exporté avant la
   * migration 004 — en reçoit une, sans quoi ses champs seraient refusés.
   */
  const sourceSections =
    formJson.sections && formJson.sections.length > 0
      ? formJson.sections
      : [
          {
            id: '__implicite__',
            form_id: newFormId,
            title: {} as MultilingualText,
            description: {} as MultilingualText,
            section_order: 0
          }
        ];

  // Les identifiants des champs sont attribués avant tout le reste : le verrou
  // de visibilité d'une section cite des questions, et les sections sont
  // construites en premier.
  const fieldIdMap: Record<string, string> = {};
  for (const field of formJson.fields ?? []) fieldIdMap[field.id] = uuid();

  const sectionIdMap: Record<string, string> = {};
  const mappedSections = sourceSections
    .slice()
    .sort((a, b) => a.section_order - b.section_order)
    .map((section, index) => {
      const newId = uuid();
      sectionIdMap[section.id] = newId;
      return {
        id: newId,
        form_id: newFormId,
        title: normalizeMultilingual(section.title),
        description: normalizeMultilingual(section.description),
        section_order: index,
        visibility: undefined as VisibilityRule | undefined,
        hidden: false
      };
    });

  const fallbackSectionId = mappedSections[0].id;

  // 1. Remap fields and options/rows
  const optionIdMap: Record<string, string> = {};

  const mappedFields: Field[] = (formJson.fields || []).map((field, index) => {
    const newFieldId = fieldIdMap[field.id];
    
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
      section_id: sectionIdMap[field.section_id] ?? fallbackSectionId,
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

  // 1 bis. Verrous de visibilité et champs calculés.
  //
  // En seconde passe, et non dans la boucle ci-dessus : un verrou peut citer une
  // question placée plus bas dans le formulaire, et il désigne les options par
  // leur identifiant — or `optionIdMap` n'est complet qu'une fois tous les
  // champs parcourus. Réécrit à la volée, un verrou sur deux resterait branché
  // sur le formulaire d'origine.
  for (const field of mappedFields) {
    const source = (formJson.fields || []).find((f) => fieldIdMap[f.id] === field.id);
    field.visibility = remapVisibility(source?.visibility, fieldIdMap, optionIdMap);
    field.calc = remapCalc(source?.calc, fieldIdMap) ?? undefined;
    field.repeater = source?.repeater;
  }

  for (const section of mappedSections) {
    const source = sourceSections.find((s) => sectionIdMap[s.id] === section.id) as
      | Partial<Section>
      | undefined;
    section.visibility = remapVisibility(source?.visibility, fieldIdMap, optionIdMap);
    section.hidden = source?.hidden ?? false;
  }

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
      target_section_id: rule.target_section_id ? (sectionIdMap[rule.target_section_id] ?? null) : null,
      rule_order: rule.rule_order
    } as any;
  });
  
  // 3. Insert form
  const formData = {
    id: newFormId,
    team_id: teamId,
    project_id: projectId,
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
  const { error: sectionsError } = await supabase.from('sections').insert(mappedSections);
  if (sectionsError) {
    await supabase.from('forms').delete().eq('id', newFormId);
    throw sectionsError;
  }

  if (mappedFields.length > 0) {
    const { error: fieldsError } = await supabase
      .from('fields')
      .insert(mappedFields.map((f) => toFieldRow(f, newFormId)));
    if (fieldsError) {
      await supabase.from('forms').delete().eq('id', newFormId);
      throw fieldsError;
    }
  }
  
  // 5. Insert rules
  if (mappedRules.length > 0) {
    const { error: rulesError } = await supabase
      .from('logic_rules')
      .insert(mappedRules.map((r) => toLogicRuleRow(r, newFormId)));
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