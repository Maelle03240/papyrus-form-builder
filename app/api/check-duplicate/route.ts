import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Indique si une adresse email a déjà répondu à ce formulaire, pour l'option
 * « un seul envoi par personne ».
 *
 * Cette route renvoyait systématiquement `duplicate: false` : le réglage était
 * affiché dans le builder mais n'avait aucun effet.
 *
 * Elle sert uniquement de confort d'interface (prévenir avant de tout ressaisir).
 * Le contrôle qui fait foi reste celui de /api/submit/[slug], côté écriture.
 */

const BodySchema = z.object({
  form_id: z.string().uuid(),
  email: z.string().email().max(254)
});

export async function POST(request: NextRequest) {
  // Cette route confirme l'existence d'un email en base : sans limite, elle
  // permettrait d'énumérer les répondants d'un formulaire.
  const limit = rateLimit(`dup:${clientIp(request.headers)}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop de requêtes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'form_id et email valides sont requis.' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Le contrôle n'a de sens que sur un formulaire publié qui active l'option.
  const { data: form } = await supabase
    .from('forms')
    .select('id, status, unique_email')
    .eq('id', parsed.data.form_id)
    .maybeSingle();

  if (!form || form.status !== 'published' || !form.unique_email) {
    return NextResponse.json({ duplicate: false });
  }

  const { count, error } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('form_id', parsed.data.form_id)
    .eq('respondent_email', parsed.data.email.trim().toLowerCase());

  if (error) {
    console.error('Erreur check-duplicate:', error);
    // En cas d'échec, ne pas bloquer le répondant : /api/submit tranchera.
    return NextResponse.json({ duplicate: false });
  }

  return NextResponse.json({ duplicate: (count ?? 0) > 0 });
}
