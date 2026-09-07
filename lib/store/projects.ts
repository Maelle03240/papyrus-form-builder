'use client';

/**
 * Projets — la couche entre l'espace de travail et le formulaire.
 *
 * Un projet regroupe plusieurs formulaires et porte ce qui leur est commun : la
 * marque, les langues, les modules activés. La règle qui décide de tout le
 * reste : une configuration qui référence des champs appartient au formulaire ;
 * tout le reste appartient au projet.
 *
 * Attention au vocabulaire, il y a trois niveaux et deux d'entre eux portent des
 * noms trompeurs :
 *
 *   teams (base) = « espace de travail » (interface) → projects → forms
 *
 * `lib/store/workspaces.ts` s'occupe du premier niveau, ce module du deuxième.
 */

import type { Form, Project, ProjectModules, ProjectStatus } from '@/types';
import { DEFAULT_PROJECT_MODULES } from '@/types';
import { createClient } from '@/lib/supabase/client';

const PROJECTS_CHANGED = 'papyrus:projects-changed';

export const PROJECTS_EVENT = PROJECTS_CHANGED;

function notifyChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROJECTS_CHANGED));
  }
}

interface ProjectRow {
  id: string;
  team_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus | null;
  languages: string[] | null;
  default_language: string | null;
  theme: Record<string, unknown> | null;
  modules: Partial<ProjectModules> | null;
  created_at: string;
  updated_at: string;
}

/**
 * Complète les modules d'une ligne avec les valeurs par défaut.
 *
 * La colonne est un jsonb : rien ne garantit qu'elle porte toutes les clés, ni
 * qu'elle n'en porte pas d'inconnues. Un module absent doit se lire
 * « désactivé », jamais `undefined` — sinon un onglet apparaît ou disparaît
 * d'une ligne à l'autre, et l'écart ne se voit qu'en production.
 *
 * Exporté pour être testé : c'est une règle d'affichage, pas un détail d'accès
 * aux données.
 */
export function normalizeProjectModules(raw: unknown): ProjectModules {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_PROJECT_MODULES };

  for (const key of Object.keys(DEFAULT_PROJECT_MODULES) as (keyof ProjectModules)[]) {
    if (typeof source[key] === 'boolean') result[key] = source[key] as boolean;
  }

  return result;
}

function toProject(row: ProjectRow, formCount?: number): Project {
  return {
    id: row.id,
    team_id: row.team_id,
    created_by: row.created_by,
    name: row.name,
    description: row.description ?? '',
    status: row.status ?? 'active',
    languages: row.languages ?? ['fr'],
    default_language: row.default_language ?? 'fr',
    theme: (row.theme ?? {}) as Project['theme'],
    modules: normalizeProjectModules(row.modules),
    created_at: row.created_at,
    updated_at: row.updated_at,
    form_count: formCount
  };
}

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Utilisateur non authentifié');
  return user;
}

// ============================================================================
// Lecture
// ============================================================================

/**
 * Tous les projets des espaces dont l'utilisateur est membre.
 *
 * L'appartenance est interrogée explicitement plutôt que laissée à la RLS : la
 * policy `team_members` est récursive si on la sollicite sans filtre sur
 * `user_id`, ce qui est déjà le motif retenu dans `listForms`.
 */
export async function listProjects(teamId?: string): Promise<Project[]> {
  const supabase = createClient();
  const user = await requireUser();

  let teamIds: string[];
  if (teamId) {
    teamIds = [teamId];
  } else {
    const { data: memberships, error: memberError } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id);
    if (memberError) throw memberError;
    teamIds = (memberships ?? []).map((m) => m.team_id as string);
  }

  if (teamIds.length === 0) return [];

  // Le compte de formulaires vient d'un select imbriqué : une requête plutôt
  // qu'une par projet. Les modèles en sont exclus — ils n'appartiennent à aucun
  // projet et ne doivent pas gonfler le compte.
  const { data, error } = await supabase
    .from('projects')
    .select('*, forms(id, is_template)')
    .in('team_id', teamIds)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const { forms, ...project } = row as ProjectRow & {
      forms?: { id: string; is_template: boolean }[];
    };
    const count = (forms ?? []).filter((f) => !f.is_template).length;
    return toProject(project, count);
  });
}

export async function getProject(id: string): Promise<Project | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('*, forms(id, is_template)')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { forms, ...project } = data as ProjectRow & {
    forms?: { id: string; is_template: boolean }[];
  };
  return toProject(project, (forms ?? []).filter((f) => !f.is_template).length);
}

/** Les formulaires d'un projet, du plus récemment modifié au plus ancien. */
export async function getProjectForms(projectId: string): Promise<Form[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('forms')
    .select('*, fields(*), logic_rules(*)')
    .eq('project_id', projectId)
    .eq('is_template', false)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((form) => ({
    ...form,
    fields: (form.fields ?? []).sort(
      (a: { field_order: number }, b: { field_order: number }) => a.field_order - b.field_order
    ),
    logic_rules: (form.logic_rules ?? []).sort(
      (a: { rule_order: number }, b: { rule_order: number }) => a.rule_order - b.rule_order
    )
  })) as Form[];
}

// ============================================================================
// Écriture
// ============================================================================

export interface CreateProjectInput {
  name: string;
  description?: string;
  teamId: string;
  modules?: Partial<ProjectModules>;
  languages?: string[];
  defaultLanguage?: string;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const supabase = createClient();
  const user = await requireUser();

  const { data, error } = await supabase
    .from('projects')
    .insert({
      team_id: input.teamId,
      created_by: user.id,
      name: input.name.trim() || 'Nouveau projet',
      description: input.description?.trim() ?? '',
      languages: input.languages ?? ['fr'],
      default_language: input.defaultLanguage ?? 'fr',
      modules: { ...DEFAULT_PROJECT_MODULES, ...(input.modules ?? {}) }
    })
    .select()
    .single();

  if (error) throw error;

  notifyChanged();
  return toProject(data as ProjectRow, 0);
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'status' | 'languages' | 'default_language' | 'theme'>> & {
    modules?: Partial<ProjectModules>;
  }
): Promise<Project | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('projects')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw error;

  notifyChanged();
  return data ? toProject(data as ProjectRow) : null;
}

/**
 * Supprime un projet — et, par cascade en base, tous ses formulaires, leurs
 * champs et leurs réponses. C'est irréversible : l'appelant doit le dire.
 */
export async function deleteProject(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
  notifyChanged();
}

export async function archiveProject(id: string): Promise<Project | null> {
  return updateProject(id, { status: 'archived' });
}

export async function unarchiveProject(id: string): Promise<Project | null> {
  return updateProject(id, { status: 'active' });
}
