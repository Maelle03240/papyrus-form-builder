import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { decryptSecret } from '@/lib/crypto';
import { listForms, TallyApiError } from '@/lib/tally/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liste les formulaires Tally accessibles avec la clé enregistrée pour cet espace. */
export async function GET(request: Request) {
  const teamId = new URL(request.url).searchParams.get('teamId');
  if (!teamId) {
    return NextResponse.json({ error: 'Paramètre teamId manquant' }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership || membership.role === 'reader') {
    return NextResponse.json({ error: 'Droits insuffisants' }, { status: 403 });
  }

  const { data: credentials } = await admin
    .from('tally_credentials')
    .select('encrypted_api_key')
    .eq('team_id', teamId)
    .maybeSingle();

  if (!credentials) {
    return NextResponse.json(
      { error: "Aucune clé API Tally enregistrée pour cet espace de travail." },
      { status: 404 }
    );
  }

  try {
    const forms = await listForms(decryptSecret(credentials.encrypted_api_key));
    return NextResponse.json({
      forms: forms.map((form) => ({
        id: form.id,
        name: form.name,
        status: form.status ?? null,
        submissions: form.numberOfSubmissions ?? null
      }))
    });
  } catch (error) {
    if (error instanceof TallyApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status === 429 ? 429 : 400 });
    }
    console.error('Erreur listing Tally:', error);
    return NextResponse.json({ error: 'Impossible de contacter Tally.' }, { status: 502 });
  }
}
