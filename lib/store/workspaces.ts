'use client';

import type { Form, Workspace, WorkspaceMember, WorkspaceRole, WorkspaceScope } from '@/types';
import { createClient } from '@/lib/supabase/client';

/**
 * Espaces de travail — adossés à la table `teams`.
 *
 * Dans l'interface on parle d'« espace de travail », en base de « team » : ce
 * sont la même chose. Ce module remplace l'ancien `local-workspaces.ts`, qui
 * gardait tout dans le localStorage du navigateur : un espace créé sur un poste
 * n'existait nulle part ailleurs et aucun collègue ne pouvait le voir.
 *
 * Les fonctions sont asynchrones (contrairement aux anciennes, synchrones) —
 * c'est la conséquence directe du passage à une vraie base.
 */

const WORKSPACES_CHANGED = 'papyrus:workspaces-changed';

function notifyChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WORKSPACES_CHANGED));
  }
}

export const WORKSPACES_EVENT = WORKSPACES_CHANGED;

interface TeamRow {
  id: string;
  name: string;
  scope: WorkspaceScope | null;
  is_deletable: boolean | null;
  created_by: string | null;
  created_at: string;
}

function toWorkspace(row: TeamRow, formCount = 0): Workspace {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope ?? 'team',
    is_deletable: row.is_deletable ?? true,
    created_by: row.created_by ?? '',
    created_at: row.created_at,
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

/** Tous les espaces dont l'utilisateur courant est membre, avec le nombre de formulaires. */
export async function getWorkspaces(): Promise<Workspace[]> {
  const supabase = createClient();
  const user = await requireUser();

  const { data: memberships, error } = await supabase
    .from('team_members')
    .select('team_id, teams(id, name, scope, is_deletable, created_by, created_at)')
    .eq('user_id', user.id);

  if (error) throw error;

  const teams = (memberships ?? [])
    .map((m) => {
      const t = m.teams as unknown;
      return (Array.isArray(t) ? t[0] : t) as TeamRow | null;
    })
    .filter((t): t is TeamRow => Boolean(t?.id));

  if (teams.length === 0) return [];

  // Un seul appel groupé pour compter les formulaires, plutôt qu'une requête par espace.
  const { data: forms } = await supabase
    .from('forms')
    .select('team_id')
    .in(
      'team_id',
      teams.map((t) => t.id)
    );

  const countByTeam = new Map<string, number>();
  for (const form of forms ?? []) {
    countByTeam.set(form.team_id, (countByTeam.get(form.team_id) ?? 0) + 1);
  }

  return teams
    .map((team) => toWorkspace(team, countByTeam.get(team.id) ?? 0))
    .sort((a, b) => {
      // L'espace personnel remonte toujours en tête.
      if (a.scope !== b.scope) return a.scope === 'personal' ? -1 : 1;
      return a.name.localeCompare(b.name, 'fr');
    });
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('teams')
    .select('id, name, scope, is_deletable, created_by, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { count } = await supabase
    .from('forms')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', id);

  return toWorkspace(data as TeamRow, count ?? 0);
}

/** Formulaires d'un espace, du plus récemment modifié au plus ancien. */
export async function getWorkspaceForms(workspaceId: string): Promise<Form[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('forms')
    .select('*, fields(*), logic_rules(*)')
    .eq('team_id', workspaceId)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((form) => ({
    ...form,
    workspace_id: form.team_id,
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

export async function createWorkspace(name: string, scope: WorkspaceScope = 'team'): Promise<Workspace> {
  const supabase = createClient();
  const user = await requireUser();

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Le nom de l'espace ne peut pas être vide.");

  const { data: team, error } = await supabase
    .from('teams')
    .insert({
      name: trimmed,
      plan: 'free',
      scope,
      is_deletable: scope !== 'personal',
      created_by: user.id
    })
    .select('id, name, scope, is_deletable, created_by, created_at')
    .single();

  if (error) throw error;

  // Le créateur devient administrateur de son espace.
  const { error: memberError } = await supabase
    .from('team_members')
    .insert({ team_id: team.id, user_id: user.id, role: 'admin' });

  if (memberError) {
    // Sans appartenance, l'espace serait orphelin et invisible : on annule.
    await supabase.from('teams').delete().eq('id', team.id);
    throw memberError;
  }

  notifyChanged();
  return toWorkspace(team as TeamRow, 0);
}

export async function updateWorkspace(id: string, patch: { name?: string }): Promise<void> {
  const response = await fetch('/api/teams', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId: id, name: patch.name })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Impossible de renommer l'espace de travail.");
  }

  notifyChanged();
}

export async function deleteWorkspace(id: string): Promise<void> {
  const response = await fetch('/api/teams', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId: id })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Impossible de supprimer l'espace de travail.");
  }

  notifyChanged();
}

/**
 * Garantit que l'utilisateur a au moins un espace personnel.
 * Le trigger `handle_new_user` s'en charge à l'inscription ; ce filet de
 * sécurité couvre les comptes créés avant sa mise en place.
 */
export async function ensurePersonalWorkspace(): Promise<Workspace> {
  const existing = await getWorkspaces();
  const personal = existing.find((w) => w.scope === 'personal');
  if (personal) return personal;
  if (existing.length > 0) return existing[0];

  return createWorkspace('Mon espace', 'personal');
}

// ============================================================================
// Membres
// ============================================================================

export async function getMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const response = await fetch(`/api/members?teamId=${encodeURIComponent(workspaceId)}`);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Impossible de charger les membres.');
  }

  const rows = (await response.json()) as {
    user_id: string;
    role: WorkspaceRole;
    joined_at: string;
    email?: string;
    name?: string;
  }[];

  return rows.map((row) => ({
    user_id: row.user_id,
    workspace_id: workspaceId,
    role: row.role,
    joined_at: row.joined_at,
    email: row.email,
    name: row.name
  }));
}

export async function addMember(
  workspaceId: string,
  email: string,
  role: WorkspaceRole = 'member'
): Promise<void> {
  const response = await fetch('/api/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId: workspaceId, email, role })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Impossible d'ajouter ce membre.");
  }
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole
): Promise<void> {
  const response = await fetch('/api/members', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId: workspaceId, userId, role })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Impossible de modifier ce rôle.');
  }
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  const response = await fetch('/api/members', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId: workspaceId, userId })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Impossible de retirer ce membre.');
  }
}
