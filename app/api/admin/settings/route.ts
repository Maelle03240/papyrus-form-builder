import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { isAppAdmin, isValidDomain, normalizeDomain } from '@/lib/auth/access-control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Réglages d'instance : qui a le droit de créer un compte.
 *
 * La table `app_settings` n'a aucune policy d'écriture. Cette route est donc le
 * seul chemin de modification, et elle exige d'être super-administrateur —
 * un simple administrateur d'espace de travail ne doit pas pouvoir ouvrir
 * l'application à un nouveau domaine.
 */

const PatchSchema = z.object({
  allowedEmailDomains: z.array(z.string().min(1).max(253)).max(50).optional(),
  allowPublicSignup: z.boolean().optional()
});

export async function GET() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const isAdmin = await isAppAdmin(user.id);

  const { data } = await createAdminClient()
    .from('app_settings')
    .select('allowed_email_domains, allow_public_signup, updated_at')
    .eq('id', true)
    .maybeSingle();

  return NextResponse.json({
    isAppAdmin: isAdmin,
    allowedEmailDomains: data?.allowed_email_domains ?? [],
    allowPublicSignup: data?.allow_public_signup ?? true,
    updatedAt: data?.updated_at ?? null
  });
}

export async function PATCH(request: Request) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  if (!(await isAppAdmin(user.id))) {
    return NextResponse.json(
      { error: "Réservé aux super-administrateurs de l'instance." },
      { status: 403 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: user.id
  };

  if (parsed.data.allowedEmailDomains) {
    const normalized = Array.from(
      new Set(parsed.data.allowedEmailDomains.map(normalizeDomain).filter(Boolean))
    );

    const invalid = normalized.filter((domain) => !isValidDomain(domain));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Domaine invalide : ${invalid.join(', ')}` },
        { status: 400 }
      );
    }

    update.allowed_email_domains = normalized;
  }

  if (parsed.data.allowPublicSignup !== undefined) {
    update.allow_public_signup = parsed.data.allowPublicSignup;
  }

  const { data, error } = await createAdminClient()
    .from('app_settings')
    .update(update)
    .eq('id', true)
    .select('allowed_email_domains, allow_public_signup, updated_at')
    .single();

  if (error) {
    console.error('Erreur mise à jour app_settings:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }

  return NextResponse.json({
    allowedEmailDomains: data.allowed_email_domains,
    allowPublicSignup: data.allow_public_signup,
    updatedAt: data.updated_at
  });
}
