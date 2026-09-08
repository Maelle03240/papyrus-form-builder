'use client';

import type { TeamInvitation, TeamRole, TeamMemberWithProfile, UserProfile } from '@/types';
import { createClient } from '@/lib/supabase/client';

// Utilitaire pour générer des tokens uniques
function generateInviteToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Récupère l'utilisateur actuel authentifié
 */
async function getCurrentUser() {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('User not authenticated');
  return user;
}

/**
 * Vérifie si l'utilisateur est admin de la team
 */
export async function isTeamAdmin(teamId: string): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    const supabase = createClient();

    const { data, error } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    return !error && data !== null;
  } catch {
    return false;
  }
}

/**
 * Liste les membres d'une team avec leurs profils
 */
export async function getTeamMembers(teamId: string): Promise<TeamMemberWithProfile[]> {
  const supabase = createClient();

  /**
   * Deux requêtes, et non une jointure imbriquée.
   *
   * `profiles:user_id (...)` demandait à PostgREST de suivre un lien qui
   * n'existe pas : `team_members.user_id` référence `auth.users`, et
   * `profiles.id` aussi — deux flèches vers la même cible, jamais l'une vers
   * l'autre. PostgREST répondait donc `PGRST200`, la promesse échouait, et
   * l'écran Paramètres → Équipe restait vide : ni membres, ni invitations, ni
   * nom d'équipe. Le seul signe visible était une ligne dans la console.
   *
   * Le rapprochement se fait ici. Il coûte un aller-retour de plus et ne peut
   * pas casser : rien à déduire, rien à mettre en cache.
   */
  const { data, error } = await supabase
    .from('team_members')
    .select('user_id, team_id, role, joined_at')
    .eq('team_id', teamId)
    .order('joined_at', { ascending: false });

  if (error) throw error;

  const members = data ?? [];
  const ids = members.map((member) => member.user_id).filter(Boolean);

  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, first_name, last_name, email').in('id', ids)
    : { data: [] };

  const byId = new Map(
    ((profiles ?? []) as { id: string; first_name?: string; last_name?: string; email?: string }[])
      .map((profile) => [profile.id, profile])
  );

  return members.map(member => {
    const profile = byId.get(member.user_id);
    return {
      user_id: member.user_id,
      team_id: member.team_id,
      role: member.role as TeamRole,
      joined_at: member.joined_at,
      name: profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') : undefined,
      email: profile?.email
    };
  });
}

/**
 * Liste les invitations en attente pour une team
 */
export async function getTeamInvitations(teamId: string): Promise<TeamInvitation[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('team_invitations')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Crée une invitation par email
 */
export async function createEmailInvitation(
  teamId: string,
  email: string,
  role: TeamRole = 'member'
): Promise<TeamInvitation> {
  const user = await getCurrentUser();
  const supabase = createClient();

  // Vérifier les permissions
  const canInvite = await isTeamAdmin(teamId);
  if (!canInvite) {
    throw new Error('Only team admins can send invitations');
  }

  /**
   * Déjà membre ?
   *
   * La question n'a de sens que si cette adresse correspond à un compte. Le
   * code interrogeait `team_members` avec `user_id = null` quand ce n'était pas
   * le cas — une comparaison qui ne renvoie jamais rien, et une requête pour
   * rien à chaque invitation d'une personne qui n'a pas encore de compte,
   * c'est-à-dire le cas courant.
   */
  const existingUserId = await getUserByEmail(email);

  if (existingUserId) {
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId)
      .eq('user_id', existingUserId)
      .maybeSingle();

    if (existingMember) {
      throw new Error('Cette personne est déjà membre de cet espace de travail.');
    }
  }

  // Annuler les invitations en attente pour ce même email
  await supabase
    .from('team_invitations')
    .update({ status: 'expired' })
    .eq('team_id', teamId)
    .eq('email', email)
    .eq('status', 'pending');

  // Créer l'invitation
  const { data, error } = await supabase
    .from('team_invitations')
    .insert({
      team_id: teamId,
      invited_by: user.id,
      invitation_type: 'email',
      email: email,
      role: role,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 jours
    })
    .select()
    .single();

  if (error) throw error;

  // Envoyer l'email d'invitation via Supabase Auth
  await sendInvitationEmail(email, teamId, data.id);

  return data;
}

/**
 * Crée une invitation par lien
 */
export async function createLinkInvitation(
  teamId: string,
  role: TeamRole = 'member'
): Promise<TeamInvitation> {
  const user = await getCurrentUser();
  const supabase = createClient();

  // Vérifier les permissions
  const canInvite = await isTeamAdmin(teamId);
  if (!canInvite) {
    throw new Error('Only team admins can create invitation links');
  }

  const { data, error } = await supabase
    .from('team_invitations')
    .insert({
      team_id: teamId,
      invited_by: user.id,
      invitation_type: 'link',
      invite_token: generateInviteToken(),
      role: role,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 jours
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Supprime une invitation
 */
export async function deleteInvitation(invitationId: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from('team_invitations')
    .delete()
    .eq('id', invitationId);

  if (error) throw error;
}

/**
 * Accepte une invitation (utilise la fonction SQL)
 */
export async function acceptInvitation(invitationId: string): Promise<{ success: boolean; error?: string; team_id?: string }> {
  const supabase = createClient();

  const { data, error } = await supabase
    .rpc('accept_team_invitation', { invitation_id: invitationId });

  if (error) {
    return { success: false, error: error.message };
  }

  return data;
}

/**
 * Récupère une invitation par token
 */
export async function getInvitationByToken(token: string): Promise<TeamInvitation | null> {
  const supabase = createClient();

  /**
   * Une fonction, et non une lecture de table.
   *
   * L'invité n'est ni membre ni administrateur de l'équipe qu'on lui propose de
   * rejoindre : aucune policy de lecture ne le concerne, et la lecture directe
   * renvoyait donc toujours zéro ligne. La page affichait « cette invitation
   * n'existe pas ou a expiré » à quelqu'un qui tenait un lien parfaitement
   * valide — depuis toujours.
   *
   * Ouvrir `team_invitations` en lecture aurait réglé cela et ouvert bien pire :
   * qui peut lire la table peut lister tous les jetons en attente, donc
   * rejoindre n'importe quelle équipe. `invitation_by_token` exige le jeton
   * exact et ne se parcourt pas.
   */
  const { data, error } = await supabase.rpc('invitation_by_token', { p_token: token });

  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return null;

  return {
    id: row.id,
    team_id: row.team_id,
    role: row.role,
    invitation_type: row.invitation_type,
    email: row.email,
    expires_at: row.expires_at,
    status: 'pending',
    teams: { name: row.team_name }
  } as unknown as TeamInvitation;
}

/**
 * Supprime un membre de la team
 */
export async function removeMember(teamId: string, userId: string): Promise<void> {
  const supabase = createClient();

  // Vérifier les permissions
  const canRemove = await isTeamAdmin(teamId);
  if (!canRemove) {
    throw new Error('Only team admins can remove members');
  }

  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * Change le rôle d'un membre
 */
export async function changeMemberRole(teamId: string, userId: string, newRole: TeamRole): Promise<void> {
  const supabase = createClient();

  // Vérifier les permissions
  const canChange = await isTeamAdmin(teamId);
  if (!canChange) {
    throw new Error('Only team admins can change member roles');
  }

  const { error } = await supabase
    .from('team_members')
    .update({ role: newRole })
    .eq('team_id', teamId)
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * Utilitaire pour récupérer l'ID utilisateur par email
 */
async function getUserByEmail(email: string): Promise<string | null> {
  const supabase = createClient();

  // `maybeSingle` : une adresse inconnue est le cas NORMAL quand on invite
  // quelqu'un. `single` en faisait une erreur PostgREST journalisée à chaque
  // invitation.
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();

  return data?.id || null;
}

/**
 * Envoie un email d'invitation via Supabase Auth
 */
async function sendInvitationEmail(email: string, teamId: string, invitationId: string): Promise<void> {
  const supabase = createClient();

  // Récupérer les infos de la team
  const { data: team } = await supabase
    .from('teams')
    .select('name')
    .eq('id', teamId)
    .single();

  const inviteUrl = `${window.location.origin}/invite?id=${invitationId}`;

  // Utiliser Supabase Auth pour envoyer l'invitation
  // Note: Cette méthode nécessite une configuration spéciale côté Supabase
  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: inviteUrl,
    data: {
      team_name: team?.name || 'Une équipe',
      invitation_id: invitationId
    }
  });

  if (error) {
    console.error('Error sending invitation email:', error);
    // Ne pas faire échouer la création de l'invitation si l'email échoue
  }
}

/**
 * Met à jour le profil utilisateur
 */
export async function updateUserProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Récupère le profil utilisateur
 */
export async function getUserProfile(): Promise<UserProfile | null> {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) return null;
  return data;
}

/**
 * Change le mot de passe de l'utilisateur
 */
export async function changePassword(newPassword: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.auth.updateUser({
    password: newPassword
  });

  if (error) throw error;
}

/**
 * Change l'email de l'utilisateur
 */
export async function changeEmail(newEmail: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.auth.updateUser({
    email: newEmail
  });

  if (error) throw error;
}

/**
 * Récupère les infos complètes d'une équipe
 */
export async function getTeam(teamId: string) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('id', teamId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Met à jour le nom de l'équipe (admin seulement)
 */
export async function updateTeamName(teamId: string, newName: string): Promise<void> {
  const supabase = createClient();

  // Vérifier les permissions
  const canUpdate = await isTeamAdmin(teamId);
  if (!canUpdate) {
    throw new Error('Only team admins can update team name');
  }

  const { error } = await supabase
    .from('teams')
    .update({ name: newName })
    .eq('id', teamId);

  if (error) throw error;
}