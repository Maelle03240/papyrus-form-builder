import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/server';
import { allocatePartnerCode, requirePartnerByToken } from '@/lib/partners-server';
import { partnerConfigOf } from '@/lib/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({ project_id: z.string().uuid() });

/**
 * Un partenaire rejoint un projet depuis son portail.
 *
 * Route serveur et non écriture directe : un partenaire n'a AUCUNE policy sur
 * les tables — il ne lit que quatre vues. Donner une policy d'insertion sur
 * `project_partners` reviendrait à autoriser « insérer une ligne qui me
 * rattache à un projet » et à devoir écrire, en SQL, toutes les conditions
 * vérifiées ici : projet de son équipe, programme ouvert, formulaire publié.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const guard = await requirePartnerByToken(token);
  if ('error' in guard) return guard.error;

  const { partner } = guard;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Projet manquant.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: project } = await admin
    .from('projects')
    .select('id, team_id, status, partner_config')
    .eq('id', parsed.data.project_id)
    .maybeSingle();

  // Les quatre conditions du « catalogue » de mooove-invoice, refaites côté
  // serveur : la vue qui alimente l'écran les applique déjà, mais un appel
  // direct ne passe pas par la vue.
  const config = partnerConfigOf(project?.partner_config);
  if (
    !project ||
    project.team_id !== partner.team_id ||
    project.status !== 'active' ||
    config.enabled !== true
  ) {
    return NextResponse.json({ error: 'Ce projet n’est pas ouvert aux partenaires.' }, { status: 404 });
  }

  const { data: published } = await admin
    .from('forms')
    .select('id')
    .eq('project_id', project.id)
    .eq('status', 'published')
    .limit(1)
    .maybeSingle();

  if (!published) {
    return NextResponse.json(
      { error: 'Ce projet n’a pas encore de formulaire publié.' },
      { status: 409 }
    );
  }

  const { data: existing } = await admin
    .from('project_partners')
    .select('id, code')
    .eq('project_id', project.id)
    .eq('partner_id', partner.id)
    .maybeSingle();

  // Rejoindre deux fois n'est pas une erreur : c'est un double clic, ou un
  // retour en arrière du navigateur. On renvoie le lien déjà créé.
  if (existing) {
    return NextResponse.json({ code: existing.code, already_joined: true });
  }

  const { data: link, error } = await admin
    .from('project_partners')
    .insert({
      project_id: project.id,
      partner_id: partner.id,
      code: await allocatePartnerCode(partner.name)
    })
    .select('code')
    .single();

  if (error) {
    console.error('Rattachement partenaire échoué:', error);
    return NextResponse.json({ error: 'Le lien de partage n’a pas pu être créé.' }, { status: 500 });
  }

  return NextResponse.json({ code: link.code, already_joined: false });
}
