import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { passwordMatches, signFormAccessToken } from '@/lib/form-access';
import { getUnlockedPublicForm } from '@/lib/public-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Déverrouillage d'un formulaire protégé par mot de passe.
 *
 * En cas de succès, la réponse contient le formulaire complet — questions et
 * règles logiques — ainsi qu'un jeton d'accès signé. C'est le seul chemin par
 * lequel le contenu d'un formulaire protégé parvient à un navigateur : la page
 * publique n'en envoie rien tant que le mot de passe n'a pas été validé.
 *
 * Le rate limit est délibérément serré : cinq essais par minute rendent une
 * attaque par dictionnaire inopérante sur un mot de passe de longueur normale.
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);

  let body: { slug?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const slug = typeof body.slug === 'string' ? body.slug.slice(0, 200) : '';
  if (!slug) {
    return NextResponse.json({ error: 'Formulaire introuvable.' }, { status: 404 });
  }

  const limit = rateLimit(`access:${slug}:${ip}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop de tentatives. Réessayez dans une minute.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const { data: form } = await createAdminClient()
    .from('forms')
    .select('id, status, closes_at, access_type, access_password')
    .eq('slug', slug)
    .maybeSingle();

  if (!form || form.status !== 'published') {
    return NextResponse.json({ error: 'Formulaire introuvable.' }, { status: 404 });
  }

  if (form.closes_at && new Date(form.closes_at) < new Date()) {
    return NextResponse.json({ error: 'Ce formulaire est fermé.' }, { status: 403 });
  }

  if (form.access_type !== 'password' || !form.access_password) {
    return NextResponse.json({ error: "Ce formulaire n'est pas protégé." }, { status: 400 });
  }

  if (!passwordMatches(form.access_password, body.password)) {
    return NextResponse.json({ error: 'Mot de passe incorrect.' }, { status: 401 });
  }

  const unlocked = await getUnlockedPublicForm(slug);
  if (!unlocked) {
    return NextResponse.json({ error: 'Formulaire introuvable.' }, { status: 404 });
  }

  let accessToken: string;
  try {
    accessToken = signFormAccessToken(form.id);
  } catch (error) {
    console.error('Signature du jeton d’accès impossible:', error);
    return NextResponse.json(
      {
        error:
          "La protection par mot de passe n'est pas utilisable sur cette instance (APP_ENCRYPTION_KEY absente)."
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ form: unlocked, accessToken });
}
