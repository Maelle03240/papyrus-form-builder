import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { verifyFormAccessToken } from '@/lib/form-access';
import type { Field, FormSettings } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Enregistrement d'une réponse partielle.
 *
 * Le répondant a commencé à remplir le formulaire sans l'envoyer. Si l'auteur a
 * activé l'option, ce qu'il a déjà saisi est conservé sous forme d'ébauche,
 * remplacée à chaque appel puis convertie en réponse définitive au moment de
 * l'envoi (voir la route parente).
 *
 * Ce que cette route ne fait PAS, volontairement :
 *  · elle ne valide pas les champs obligatoires — une ébauche est incomplète
 *    par définition ;
 *  · elle ne déclenche ni notification, ni synchronisation Google Sheets — la
 *    feuille de calcul ne doit contenir que des réponses abouties ;
 *  · elle n'applique pas le quota de réponses, qui ne compte que les envois
 *    définitifs.
 *
 * Elle reste soumise au même durcissement que la route d'envoi : rate limit,
 * taille maximale, filtrage sur les champs réellement existants.
 */

const MAX_BODY_BYTES = 512 * 1024;
const MAX_ANSWER_LENGTH = 10_000;

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const { slug } = params;
  const ip = clientIp(request.headers);

  // La saisie est enregistrée en continu : la limite est plus haute que pour un
  // envoi définitif, mais elle existe.
  const limit = rateLimit(`partial:${slug}:${ip}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop de requêtes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Réponse trop volumineuse.' }, { status: 413 });
  }

  let body: {
    responses?: Record<string, unknown>;
    language?: string;
    sessionId?: string;
    accessToken?: string;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const sessionId = body.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length < 8 || sessionId.length > 100) {
    return NextResponse.json({ error: 'Session invalide.' }, { status: 400 });
  }

  const submittedResponses = body.responses;
  if (!submittedResponses || typeof submittedResponses !== 'object' || Array.isArray(submittedResponses)) {
    return NextResponse.json({ error: 'Réponses manquantes ou invalides.' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, status, closes_at, access_type, settings, fields(id, type)')
    .eq('slug', slug)
    .maybeSingle();

  if (formError) {
    console.error('Erreur récupération formulaire (partielle):', formError);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }

  if (!form || form.status !== 'published') {
    return NextResponse.json({ error: 'Formulaire introuvable' }, { status: 404 });
  }

  if (form.closes_at && new Date(form.closes_at) < new Date()) {
    return NextResponse.json({ error: 'Ce formulaire est fermé.' }, { status: 403 });
  }

  // Même exigence que pour l'envoi définitif : sur un formulaire protégé, seul
  // un jeton délivré après validation du mot de passe autorise l'écriture.
  if (form.access_type === 'password' && !verifyFormAccessToken(form.id, body.accessToken)) {
    return NextResponse.json({ error: 'Formulaire protégé.' }, { status: 401 });
  }

  const settings = (form.settings ?? {}) as FormSettings;
  if (!settings.partial_submissions) {
    // L'option est désactivée : on ne stocke rien, mais on ne traite pas cela
    // comme une erreur — le client peut avoir un réglage périmé en cache.
    return NextResponse.json({ stored: false });
  }

  const knownFieldIds = new Set(
    ((form.fields ?? []) as Pick<Field, 'id' | 'type'>[])
      .filter((f) => !['section_break', 'statement', 'image', 'video'].includes(f.type))
      .map((f) => f.id)
  );

  const responses: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(submittedResponses)) {
    if (!knownFieldIds.has(key.split('__')[0])) continue;

    if (typeof value === 'string') {
      responses[key] = value.slice(0, MAX_ANSWER_LENGTH);
    } else if (Array.isArray(value)) {
      responses[key] = value
        .slice(0, 200)
        .map((item) => (typeof item === 'string' ? item.slice(0, MAX_ANSWER_LENGTH) : item));
    } else {
      responses[key] = value;
    }
  }

  if (Object.keys(responses).length === 0) {
    return NextResponse.json({ stored: false });
  }

  // Une session déjà convertie en réponse définitive ne doit plus être écrasée :
  // sans cette garde, un onglet resté ouvert repasserait l'envoi en ébauche.
  const { data: existing } = await supabase
    .from('submissions')
    .select('id, is_partial')
    .eq('form_id', form.id)
    .eq('session_id', sessionId)
    .maybeSingle();

  if (existing && !existing.is_partial) {
    return NextResponse.json({ stored: false, alreadySubmitted: true });
  }

  const now = new Date().toISOString();

  const { error } = existing
    ? await supabase
        .from('submissions')
        .update({ responses, completed_at: now })
        .eq('id', existing.id)
    : await supabase.from('submissions').insert({
        form_id: form.id,
        responses,
        respondent_language:
          typeof body.language === 'string' ? body.language.slice(0, 10) : 'fr',
        completed_at: now,
        actions_triggered: [],
        source: 'papyrus',
        is_partial: true,
        session_id: sessionId
      });

  if (error) {
    console.error('Erreur enregistrement réponse partielle:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }

  return NextResponse.json({ stored: true });
}
