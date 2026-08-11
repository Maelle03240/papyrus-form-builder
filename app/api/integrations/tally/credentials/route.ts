import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { decryptSecret, encryptSecret, isEncryptionConfigured, maskSecret } from '@/lib/crypto';
import { listForms, TallyApiError } from '@/lib/tally/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Clé API Tally d'un espace de travail.
 *
 * La clé est chiffrée avant insertion et n'est jamais renvoyée au navigateur —
 * seule une version masquée (`tly_…a3f9`) sert à confirmer qu'elle est bien
 * enregistrée. La table `tally_credentials` n'a aucune policy RLS de lecture :
 * cette route est le seul accès, et elle passe par service_role.
 */

const PostSchema = z.object({
  teamId: z.string().uuid(),
  apiKey: z.string().min(10).max(500)
});

async function requireTeamAdmin(teamId: string) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) };

  const { data } = await createAdminClient()
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (data?.role !== 'admin') {
    return {
      error: NextResponse.json(
        { error: "Seul un administrateur de l'espace peut gérer cette connexion." },
        { status: 403 }
      )
    };
  }

  return { user };
}

/** Indique si une clé est enregistrée, sans jamais la divulguer. */
export async function GET(request: Request) {
  const teamId = new URL(request.url).searchParams.get('teamId');
  if (!teamId) {
    return NextResponse.json({ error: 'Paramètre teamId manquant' }, { status: 400 });
  }

  const guard = await requireTeamAdmin(teamId);
  if ('error' in guard) return guard.error;

  const { data } = await createAdminClient()
    .from('tally_credentials')
    .select('encrypted_api_key, updated_at')
    .eq('team_id', teamId)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ connected: false });
  }

  let masked: string | null = null;
  try {
    masked = maskSecret(decryptSecret(data.encrypted_api_key));
  } catch {
    // Clé illisible : APP_ENCRYPTION_KEY a changé depuis l'enregistrement.
    return NextResponse.json({
      connected: true,
      maskedKey: null,
      needsReconnect: true
    });
  }

  return NextResponse.json({
    connected: true,
    maskedKey: masked,
    updatedAt: data.updated_at,
    needsReconnect: false
  });
}

/** Enregistre une clé après l'avoir validée auprès de Tally. */
export async function POST(request: Request) {
  if (!isEncryptionConfigured()) {
    return NextResponse.json(
      {
        error:
          "Le chiffrement des secrets n'est pas configuré (APP_ENCRYPTION_KEY). Contactez un administrateur."
      },
      { status: 503 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const parsed = PostSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
  }

  const guard = await requireTeamAdmin(parsed.data.teamId);
  if ('error' in guard) return guard.error;

  const apiKey = parsed.data.apiKey.trim();

  // Refuser d'enregistrer une clé qui ne fonctionne pas : l'erreur serait
  // sinon découverte au premier import, longtemps après la saisie.
  let formCount = 0;
  try {
    formCount = (await listForms(apiKey)).length;
  } catch (error) {
    if (error instanceof TallyApiError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Impossible de vérifier la clé Tally.' }, { status: 502 });
  }

  const now = new Date().toISOString();
  const { error } = await createAdminClient().from('tally_credentials').upsert(
    {
      team_id: parsed.data.teamId,
      encrypted_api_key: encryptSecret(apiKey),
      created_by: guard.user.id,
      updated_at: now
    },
    { onConflict: 'team_id' }
  );

  if (error) {
    console.error('Erreur enregistrement clé Tally:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }

  return NextResponse.json({
    connected: true,
    maskedKey: maskSecret(apiKey),
    formCount,
    updatedAt: now
  });
}

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

  const guard = await requireTeamAdmin(teamId);
  if ('error' in guard) return guard.error;

  const { error } = await createAdminClient()
    .from('tally_credentials')
    .delete()
    .eq('team_id', teamId);

  if (error) {
    console.error('Erreur suppression clé Tally:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }

  return NextResponse.json({ connected: false });
}
