import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { allocatePartnerCode } from '@/lib/partners-server';
import { partnerConfigOf } from '@/lib/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(180),
  phone: z.string().trim().max(60).optional(),
  website: z.string().trim().max(200).optional()
});

/**
 * Auto-inscription d'un partenaire depuis le lien public /a/join/<token>.
 *
 * **Cette route n'ouvre aucun accès.** Elle enregistre une demande : la fiche
 * partenaire est créée, rattachée au projet, et c'est l'équipe qui lui ouvre
 * ensuite son portail depuis l'annuaire.
 *
 * mooove-invoice, lui, connecte le nouveau partenaire immédiatement. Ce n'est
 * pas transposable ici : le portail de Papyrus s'ouvre avec un vrai compte
 * d'authentification, et renvoyer un lien de connexion à un visiteur anonyme qui
 * a simplement TAPÉ une adresse donnerait à n'importe qui le compte de
 * n'importe qui — il suffirait d'inscrire l'adresse de sa cible. Le lien
 * d'accès ne part donc jamais d'ici.
 *
 * La réponse est volontairement identique que l'adresse soit déjà connue ou
 * non : la distinguer transformerait le formulaire en test d'appartenance
 * (« untel travaille-t-il avec eux ? »).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const ip = clientIp(request.headers);

  // Une page publique qui écrit en base : le débit est borné avant tout le
  // reste, sans quoi elle sert de fabrique à fiches partenaires.
  const limit = rateLimit(`partner-join:${ip}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop de tentatives. Réessayez dans un instant.' },
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
    return NextResponse.json(
      { error: 'Vérifiez le nom et l’adresse e-mail saisis.' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: project } = await admin
    .from('projects')
    .select('id, team_id, status, partner_config')
    .eq('partner_join_token', token)
    .maybeSingle();

  const config = partnerConfigOf(project?.partner_config);
  if (!project || project.status !== 'active' || !config.enabled || !config.self_register) {
    return NextResponse.json({ error: 'Ce lien n’est plus valable.' }, { status: 404 });
  }

  const email = parsed.data.email.toLowerCase();

  const { data: existing } = await admin
    .from('partners')
    .select('id, name')
    .eq('team_id', project.team_id)
    .ilike('email', email)
    .maybeSingle();

  let partnerId = existing?.id ?? null;
  let partnerName = existing?.name ?? parsed.data.name;

  if (!partnerId) {
    const { data: created, error } = await admin
      .from('partners')
      .insert({
        team_id: project.team_id,
        name: parsed.data.name,
        email,
        phone: parsed.data.phone ?? '',
        website: parsed.data.website ?? '',
        notes: 'Inscription depuis le lien public.'
      })
      .select('id, name')
      .single();

    if (error || !created) {
      console.error('Auto-inscription partenaire échouée:', error);
      return NextResponse.json(
        { error: 'La demande n’a pas pu être enregistrée. Réessayez.' },
        { status: 500 }
      );
    }

    partnerId = created.id;
    partnerName = created.name;
  }

  const { data: link } = await admin
    .from('project_partners')
    .select('id')
    .eq('project_id', project.id)
    .eq('partner_id', partnerId)
    .maybeSingle();

  if (!link) {
    const { error } = await admin.from('project_partners').insert({
      project_id: project.id,
      partner_id: partnerId,
      code: await allocatePartnerCode(partnerName)
    });

    if (error) {
      console.error('Rattachement au projet échoué:', error);
      return NextResponse.json(
        { error: 'La demande n’a pas pu être enregistrée. Réessayez.' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ received: true });
}
