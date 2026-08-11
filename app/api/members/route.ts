import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Membres d'un espace de travail : lecture (GET), ajout (POST), changement de
 * rôle (PATCH) et retrait (DELETE).
 *
 * Toutes les écritures utilisent la clé service_role, donc la RLS ne protège
 * rien ici : c'est ce fichier, et lui seul, qui garantit qu'un appelant est bien
 * administrateur de l'espace visé. Chaque handler revérifie ce droit — jamais
 * une seule fois en amont, jamais sur la base d'un paramètre client.
 */

const VALID_ROLES = ['admin', 'member', 'reader'] as const;

/** Utilisateur de la session, ou `null`. */
async function requireUser() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user;
}

function unauthenticated() {
  return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
}

/** L'utilisateur est-il administrateur de cet espace ? */
async function isTeamAdmin(teamId: string, userId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();

  return data?.role === 'admin';
}

/** L'utilisateur appartient-il à cet espace, quel que soit son rôle ? */
async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();

  return Boolean(data);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthenticated();

    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId');
    if (!teamId) {
      return NextResponse.json({ error: 'Paramètre teamId manquant' }, { status: 400 });
    }

    if (!(await isTeamMember(teamId, user.id))) {
      return NextResponse.json({ error: 'Droits insuffisants' }, { status: 403 });
    }

    const adminSupabase = createAdminClient();

    // Récupérer les membres de l'équipe
    const { data: members, error: membersError } = await adminSupabase
      .from('team_members')
      .select('user_id, role, joined_at')
      .eq('team_id', teamId);

    if (membersError) throw membersError;

    // Récupérer les emails des membres depuis la table profiles
    const userIds = (members || []).map((m) => m.user_id);
    const { data: profiles, error: profilesError } = await adminSupabase
      .from('profiles')
      .select('id, email')
      .in('id', userIds);

    if (profilesError) {
      console.warn("Could not load profiles, returning raw member data:", profilesError);
      return NextResponse.json(members.map(m => ({ ...m, email: `Membre (${m.user_id.slice(0, 8)}...)` })));
    }

    const emailMap = new Map(profiles.map((p) => [p.id, p.email]));
    const formatted = members.map((m) => ({
      ...m,
      email: emailMap.get(m.user_id) || `Membre (${m.user_id.slice(0, 8)}...)`
    }));

    return NextResponse.json(formatted);
  } catch (err: unknown) {
    // Le détail reste dans les logs serveur : le renvoyer au client exposerait
    // la structure de la base et les messages d'erreur Postgres.
    console.error('Error listing team members:', err);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthenticated();

    const { teamId, email, role = 'member' } = await request.json();
    if (!teamId || !email?.trim()) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Rôle invalide' }, { status: 400 });
    }

    if (!(await isTeamAdmin(teamId, user.id))) {
      return NextResponse.json({ error: 'Droits insuffisants' }, { status: 403 });
    }

    const adminSupabase = createAdminClient();

    // 1. Chercher l'utilisateur par e-mail dans profiles
    const { data: profile, error: profileError } = await adminSupabase
      .from('profiles')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Aucun utilisateur inscrit sous cette adresse e-mail.' }, { status: 404 });
    }

    // 2. Lier le membre
    const { error: insertError } = await adminSupabase
      .from('team_members')
      .insert({
        user_id: profile.id,
        team_id: teamId,
        role
      });

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json({ error: 'Cet utilisateur est déjà membre de cet espace de travail.' }, { status: 409 });
      }
      throw insertError;
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Error adding team member:', err);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }
}

/** Change le rôle d'un membre. Réservé aux administrateurs de l'espace. */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthenticated();

    const { teamId, userId, role } = await request.json();
    if (!teamId || !userId || !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Paramètres manquants ou invalides' }, { status: 400 });
    }

    if (!(await isTeamAdmin(teamId, user.id))) {
      return NextResponse.json({ error: 'Droits insuffisants' }, { status: 403 });
    }

    const adminSupabase = createAdminClient();

    // Un espace sans administrateur devient impossible à gérer : on refuse de
    // rétrograder le dernier admin restant.
    if (role !== 'admin') {
      const { count } = await adminSupabase
        .from('team_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('role', 'admin');

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Cet espace doit conserver au moins un administrateur." },
          { status: 409 }
        );
      }
    }

    const { error } = await adminSupabase
      .from('team_members')
      .update({ role })
      .eq('team_id', teamId)
      .eq('user_id', userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Error updating member role:', err);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthenticated();

    const { teamId, userId } = await request.json();
    if (!teamId || !userId) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    if (!(await isTeamAdmin(teamId, user.id))) {
      return NextResponse.json({ error: 'Droits insuffisants' }, { status: 403 });
    }

    const adminSupabase = createAdminClient();

    // Même garde-fou que pour le changement de rôle.
    const { data: target } = await adminSupabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .maybeSingle();

    if (target?.role === 'admin') {
      const { count } = await adminSupabase
        .from('team_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('role', 'admin');

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Cet espace doit conserver au moins un administrateur." },
          { status: 409 }
        );
      }
    }

    const { error } = await adminSupabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Error removing team member:', err);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }
}
