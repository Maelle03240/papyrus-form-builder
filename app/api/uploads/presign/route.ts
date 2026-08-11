import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { createPresignedUpload, validateMedia } from '@/lib/storage/r2';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Émet une URL PUT présignée vers Cloudflare R2 pour une image ou une vidéo.
 *
 * Deux usages, avec deux contrôles d'accès distincts :
 *  - `context: 'builder'`  → réservé aux utilisateurs connectés (bannière, logo,
 *    média inséré dans un formulaire) ;
 *  - `context: 'response'` → ouvert aux répondants anonymes, mais uniquement si
 *    `formSlug` désigne un formulaire réellement publié et encore ouvert.
 *
 * La validation du type MIME et de la taille se fait ici, côté serveur, AVANT
 * de signer quoi que ce soit. La clé secrète R2 ne quitte jamais le serveur.
 */

const BodySchema = z.object({
  contentType: z.string().min(1).max(255),
  size: z.number().int().positive(),
  context: z.enum(['builder', 'response']).default('builder'),
  formSlug: z.string().min(1).max(120).optional()
});

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }

  const { contentType, size, context, formSlug } = parsed.data;

  // 1. Validation du média — refus avant toute signature.
  const validation = validateMedia(contentType, size);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const ip = clientIp(request.headers);

  // 2. Contrôle d'accès selon le contexte.
  let scope: string;

  if (context === 'builder') {
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
    }

    const limit = rateLimit(`presign:builder:${user.id}`, 60, 60_000);
    if (!limit.allowed) {
      return tooManyRequests(limit.retryAfterSeconds);
    }

    scope = 'builder';
  } else {
    if (!formSlug) {
      return NextResponse.json(
        { error: 'formSlug est requis pour un envoi de répondant.' },
        { status: 400 }
      );
    }

    const limit = rateLimit(`presign:response:${ip}`, 20, 60_000);
    if (!limit.allowed) {
      return tooManyRequests(limit.retryAfterSeconds);
    }

    // Le formulaire doit exister, être publié et ne pas être clos.
    const admin = createAdminClient();
    const { data: form } = await admin
      .from('forms')
      .select('id, status, closes_at')
      .eq('slug', formSlug)
      .maybeSingle();

    if (!form || form.status !== 'published') {
      return NextResponse.json({ error: 'Formulaire non accessible.' }, { status: 403 });
    }

    if (form.closes_at && new Date(form.closes_at) < new Date()) {
      return NextResponse.json({ error: 'Ce formulaire est fermé aux réponses.' }, { status: 403 });
    }

    scope = 'responses';
  }

  // 3. Signature.
  try {
    const presigned = await createPresignedUpload(
      contentType.toLowerCase().split(';')[0].trim(),
      validation.extension ?? 'bin',
      scope
    );
    return NextResponse.json(presigned);
  } catch (error) {
    console.error("Échec de la signature d'upload R2:", error);
    return NextResponse.json(
      { error: "Le stockage média n'est pas disponible. Contactez un administrateur." },
      { status: 503 }
    );
  }
}

function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: 'Trop de requêtes. Réessayez dans un instant.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  );
}
