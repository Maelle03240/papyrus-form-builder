import { NextResponse } from 'next/server';
import { requireTeamMembership } from '@/lib/auth/form-access';
import { deleteGoogleCredentials, getGoogleConnection } from '@/lib/google/credentials';
import { isGoogleConfigured } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** État de la connexion Google d'un espace de travail. */
export async function GET(request: Request) {
  const teamId = new URL(request.url).searchParams.get('teamId');
  if (!teamId) {
    return NextResponse.json({ error: 'Paramètre teamId manquant' }, { status: 400 });
  }

  const guard = await requireTeamMembership(teamId);
  if ('error' in guard) return guard.error;

  if (!isGoogleConfigured()) {
    return NextResponse.json({ connected: false, configured: false });
  }

  const connection = await getGoogleConnection(teamId);
  return NextResponse.json({ ...connection, configured: true });
}

/** Déconnecte le compte Google et révoque le jeton côté Google. */
export async function DELETE(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const teamId = (payload as { teamId?: string })?.teamId;
  if (!teamId) {
    return NextResponse.json({ error: 'Paramètre teamId manquant' }, { status: 400 });
  }

  const guard = await requireTeamMembership(teamId);
  if ('error' in guard) return guard.error;

  if (guard.role !== 'admin') {
    return NextResponse.json(
      { error: "Seul un administrateur de l'espace peut déconnecter le compte Google." },
      { status: 403 }
    );
  }

  try {
    await deleteGoogleCredentials(teamId);
  } catch (error) {
    console.error('Déconnexion Google échouée:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }

  return NextResponse.json({ connected: false });
}
