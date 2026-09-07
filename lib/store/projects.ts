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

import type {
  Form,
  Project,
  ProjectInvoicing,
  ProjectModules,
  ProjectPricing,
  ProjectStatus
} from '@/types';
import {
  DEFAULT_PROJECT_INVOICING,
  DEFAULT_PROJECT_MODULES,
  DEFAULT_PROJECT_PRICING
} from '@/types';
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
  pricing: Partial<ProjectPricing> | null;
  invoice_prefix: string | null;
  invoice_next: number | string | null;
  invoice_pad: number | null;
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

/**
 * Complète les réglages monétaires d'une ligne avec les valeurs par défaut.
 *
 * Même raison que pour les modules : la colonne est un jsonb, et une devise
 * absente ne doit jamais se lire `undefined`. Un total affiché sans devise, ou
 * pire dans une autre que celle facturée, ne se remarque qu'une fois la facture
 * partie.
 */
export function normalizeProjectPricing(raw: unknown): ProjectPricing {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_PROJECT_PRICING };

  if (typeof source.currency === 'string' && source.currency.trim()) {
    result.currency = source.currency.trim();
  }
  if (source.currency_position === 'before' || source.currency_position === 'after') {
    result.currency_position = source.currency_position;
  }
  if (typeof source.vat_enabled === 'boolean') result.vat_enabled = source.vat_enabled;
  if (typeof source.vat_rate === 'number' && Number.isFinite(source.vat_rate)) {
    // Un taux négatif ou supérieur à cent transformerait une TVA en remise, ou
    // multiplierait la facture. Aucun des deux ne doit franchir la lecture.
    result.vat_rate = Math.min(100, Math.max(0, source.vat_rate));
  }

  return result;
}

/**
 * Réglages de numérotation d'une ligne.
 *
 * Trois colonnes réelles et non un jsonb : `invoice_next` est incrémenté sous
 * verrou de ligne par la fonction SQL `assign_invoice_number`. Un compteur
 * enfoui dans un jsonb se lirait, se modifierait et se réécrirait — et deux
 * inscriptions simultanées repartiraient du même numéro.
 *
 * `invoice_next` peut revenir en chaîne : PostgREST rend les `bigint` en texte
 * pour ne pas les tronquer au passage par un nombre JavaScript.
 */
export function normalizeProjectInvoicing(row: {
  invoice_prefix?: string | null;
  invoice_next?: number | string | null;
  invoice_pad?: number | null;
}): ProjectInvoicing {
  const next = Number(row.invoice_next);

  return {
    prefix: (row.invoice_prefix ?? '').trim() || DEFAULT_PROJECT_INVOICING.prefix,
    next: Number.isFinite(next) && next >= 1 ? Math.floor(next) : DEFAULT_PROJECT_INVOICING.next,
    // Au-delà de huit chiffres le numéro devient illisible ; en dessous d'un, il
    // n'y a plus de numéro du tout.
    pad: Math.min(8, Math.max(1, row.invoice_pad ?? DEFAULT_PROJECT_INVOICING.pad))
  };
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
    pricing: normalizeProjectPricing(row.pricing),
    invoicing: normalizeProjectInvoicing(row),
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
    pricing?: Partial<ProjectPricing>;
    invoicing?: Partial<ProjectInvoicing>;
  }
): Promise<Project | null> {
  const supabase = createClient();

  // La numérotation est un objet dans l'interface et trois colonnes en base :
  // c'est ici, et nulle part ailleurs, que la traduction a lieu.
  const { invoicing, ...rest } = patch;
  const row: Record<string, unknown> = { ...rest };
  if (invoicing) {
    if (invoicing.prefix !== undefined) row.invoice_prefix = invoicing.prefix.trim();
    if (invoicing.next !== undefined) row.invoice_next = Math.max(1, Math.floor(invoicing.next));
    if (invoicing.pad !== undefined) row.invoice_pad = Math.min(8, Math.max(1, invoicing.pad));
  }

  const { data, error } = await supabase
    .from('projects')
    .update(row)
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
