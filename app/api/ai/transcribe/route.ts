import { NextResponse, type NextRequest } from 'next/server';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { resolveAiRuntime } from '@/lib/ai/settings';
import { transcribeAudio } from '@/lib/ai/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * La dictée : un enregistrement entre, du texte sort.
 *
 * Le texte rejoint ensuite la conversation écrite habituelle — c'est le même
 * assistant, la même boucle d'outils, le même instantané. La voix n'ouvre donc
 * pas un second chemin d'écriture : elle n'est qu'une façon d'écrire.
 *
 * Contrairement au temps réel, tout passe par le serveur : la consommation est
 * mesurable, et la clé ne bouge pas.
 */

/**
 * Taille maximale d'un enregistrement.
 *
 * Vingt-cinq mégaoctets est la limite du fournisseur. La nôtre est plus basse :
 * une dictée de description de formulaire dure une minute, pas une heure, et
 * un fichier de dix mégaoctets envoyé depuis un téléphone en 3G expirerait
 * avant d'arriver.
 */
const MAX_BYTES = 10 * 1024 * 1024;

const ACCEPTED = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/mpga',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
  'audio/x-m4a'
];

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const limit = rateLimit(`ai-transcribe:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop de dictées d’affilée. Patientez un instant.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Envoi illisible.' }, { status: 400 });
  }

  const teamId = String(form.get('team_id') ?? '');
  const audio = form.get('audio');

  if (!teamId) {
    return NextResponse.json({ error: 'Espace de travail manquant.' }, { status: 400 });
  }

  if (!(audio instanceof File)) {
    return NextResponse.json({ error: 'Aucun enregistrement reçu.' }, { status: 400 });
  }

  if (audio.size === 0) {
    return NextResponse.json({ error: 'L’enregistrement est vide.' }, { status: 400 });
  }

  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'L’enregistrement dépasse 10 Mo. Dictez en plusieurs fois.' },
      { status: 413 }
    );
  }

  // Le type est vérifié ici, côté serveur, avant d'appeler quoi que ce soit :
  // c'est le seul contrôle qui compte, celui du navigateur n'engage personne.
  const mime = (audio.type || '').split(';')[0].trim().toLowerCase();
  if (mime && !ACCEPTED.includes(mime)) {
    return NextResponse.json(
      { error: 'Format audio non pris en charge.' },
      { status: 415 }
    );
  }

  const { data: membership } = await createAdminClient()
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: 'Espace de travail introuvable' }, { status: 404 });
  }

  const resolved = await resolveAiRuntime(teamId);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.reason }, { status: 409 });
  }

  const result = await transcribeAudio(resolved.runtime, audio);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }

  return NextResponse.json({ text: result.text });
}
