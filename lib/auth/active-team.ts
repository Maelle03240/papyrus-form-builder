import 'server-only';

import { cookies } from 'next/headers';

import { createAdminClient, createClient } from '@/lib/supabase/server';

/**
 * L'espace de travail courant, côté serveur.
 *
 * Le cookie `papyrus:active-team-id` porte le choix du sélecteur d'espace, mais
 * il ne fait pas foi : on vérifie toujours que l'utilisateur en est bien membre.
 * Sans cette vérification, éditer un cookie suffirait à demander les partenaires
 * et les contacts d'une autre équipe — la lecture qui suit passe en effet par
 * `service_role` dans les routes d'export.
 *
 * La requête est filtrée sur `user_id`, comme partout ailleurs : la policy
 * `team_members` se référence elle-même et boucle si on l'interroge sans ce
 * filtre.
 */
export async function getActiveTeamId(): Promise<string | null> {
  const {
    data: { user }
  } = await createClient().auth.getUser();

  if (!user) return null;

  const admin = createAdminClient();

  const { data: memberships } = await admin
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id);

  const teamIds = (memberships ?? []).map((row: { team_id: string }) => row.team_id);
  if (teamIds.length === 0) return null;

  const requested = (await cookies()).get('papyrus:active-team-id')?.value;

  return requested && teamIds.includes(requested) ? requested : teamIds[0];
}
