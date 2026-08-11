import { NextResponse, type NextRequest } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { evaluateAccess } from '@/lib/auth/access-control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Retour du fournisseur OAuth (Google) et des liens de confirmation email.
 *
 * C'est ici que la liste de domaines autorisés est appliquée. Google accepte de
 * connecter n'importe quel compte Google : sans ce filtre côté serveur, le
 * bouton « Se connecter avec Google » laisserait entrer le monde entier.
 *
 * Un compte refusé est déconnecté immédiatement, avant d'avoir pu accéder à
 * quoi que ce soit.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const redirectTo = sanitizeRedirect(searchParams.get('redirect'));
  const oauthError = searchParams.get('error_description') ?? searchParams.get('error');

  if (oauthError) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(oauthError)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  const user = data.user;

  // Contrôle d'accès — le seul qui compte, parce qu'il est serveur.
  const decision = await evaluateAccess(user.email, user.id);

  if (!decision.allowed) {
    await supabase.auth.signOut();

    // Un compte refusé ne doit pas rester en base : il pourrait être réactivé
    // plus tard par une modification de configuration sans nouveau consentement.
    try {
      await createAdminClient().auth.admin.deleteUser(user.id);
    } catch (deleteError) {
      console.error('Impossible de supprimer le compte refusé:', deleteError);
    }

    return NextResponse.redirect(`${origin}/login?error=${decision.reason}`);
  }

  await ensureProfileAndWorkspace(user.id, user.email ?? '', user.user_metadata);

  return NextResponse.redirect(`${origin}${redirectTo}`);
}

/**
 * N'accepte qu'un chemin interne. Sans ce filtre, `?redirect=https://exemple.com`
 * transformerait la page de connexion en redirection ouverte, utilisable pour
 * du hameçonnage depuis notre propre domaine.
 */
function sanitizeRedirect(value: string | null): string {
  if (!value) return '/dashboard';
  const decoded = decodeURIComponent(value);
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return '/dashboard';
  return decoded;
}

/**
 * Garantit qu'un compte fraîchement connecté dispose d'un profil et d'un espace
 * personnel. Le trigger SQL `handle_new_user` s'en charge normalement ; ce filet
 * couvre les comptes OAuth créés avant sa mise en place et les échecs partiels.
 */
async function ensureProfileAndWorkspace(
  userId: string,
  email: string,
  metadata: Record<string, unknown> | undefined
): Promise<void> {
  const admin = createAdminClient();

  const fullName = typeof metadata?.full_name === 'string' ? metadata.full_name : '';
  const [firstName, ...rest] = fullName.split(' ');

  await admin.from('profiles').upsert(
    {
      id: userId,
      email,
      ...(firstName && { first_name: firstName }),
      ...(rest.length > 0 && { last_name: rest.join(' ') })
    },
    { onConflict: 'id' }
  );

  const { data: membership } = await admin
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (membership) return;

  const { data: team } = await admin
    .from('teams')
    .insert({
      name: 'Mon espace',
      plan: 'free',
      scope: 'personal',
      is_deletable: false,
      created_by: userId
    })
    .select('id')
    .single();

  if (team) {
    await admin.from('team_members').insert({ team_id: team.id, user_id: userId, role: 'admin' });
  }
}
