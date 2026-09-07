import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { DashboardWrapper } from './DashboardWrapper';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface TeamSummary {
  id: string;
  name: string;
  plan: string;
}

/**
 * Coquille du tableau de bord : charge la session, les espaces de travail de
 * l'utilisateur et l'espace actif.
 *
 * Les lectures passent par le client d'administration parce que la policy RLS
 * de `team_members` se référence elle-même, ce qui provoque une récursion
 * infinie côté Postgres sur une jointure `team_members → teams`. Chaque requête
 * est explicitement filtrée sur `user_id = user.id` : le contournement de la RLS
 * ne remplace donc jamais le contrôle d'accès, il ne fait que l'exprimer ici.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: memberships } = await admin
    .from('team_members')
    .select('team_id, role, teams(id, name, plan)')
    .eq('user_id', user.id);

  let allTeams = extractTeams(memberships);

  // Filet de sécurité : un compte sans espace ne pourrait rien faire. Le trigger
  // `handle_new_user` s'en charge normalement à l'inscription.
  if (allTeams.length === 0) {
    const created = await createPersonalWorkspace(admin, user.id);
    if (created) allTeams = [created];
  }

  const activeTeamId = (await cookies()).get('papyrus:active-team-id')?.value;
  const activeTeam =
    allTeams.find((team) => team.id === activeTeamId) ??
    allTeams[0] ?? { id: '', name: 'Mon espace', plan: 'free' };

  return (
    <DashboardWrapper
      teamName={activeTeam.name}
      userEmail={user.email ?? ''}
      activeTeam={activeTeam}
      allTeams={allTeams}
    >
      {children}
    </DashboardWrapper>
  );
}

/** La jointure PostgREST renvoie `teams` tantôt en objet, tantôt en tableau. */
function extractTeams(memberships: { teams: unknown }[] | null): TeamSummary[] {
  return (memberships ?? [])
    .map((membership) => {
      const team = membership.teams;
      return (Array.isArray(team) ? team[0] : team) as TeamSummary | null;
    })
    .filter((team): team is TeamSummary => Boolean(team?.id));
}

async function createPersonalWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<TeamSummary | null> {
  const { data: team, error } = await admin
    .from('teams')
    .insert({
      name: 'Mon espace',
      plan: 'free',
      scope: 'personal',
      is_deletable: false,
      created_by: userId
    })
    .select('id, name, plan')
    .single();

  if (error || !team) {
    console.error("Impossible de créer l'espace personnel:", error);
    return null;
  }

  const { error: memberError } = await admin
    .from('team_members')
    .insert({ user_id: userId, team_id: team.id, role: 'admin' });

  if (memberError) {
    // Un espace sans membre est inaccessible : mieux vaut ne rien laisser.
    await admin.from('teams').delete().eq('id', team.id);
    console.error("Impossible de rattacher l'utilisateur à son espace:", memberError);
    return null;
  }

  return team;
}
