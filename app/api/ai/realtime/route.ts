import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { resolveAiRuntime } from '@/lib/ai/settings';
import { mintRealtimeSession, REALTIME_MAX_SECONDS } from '@/lib/ai/realtime';
import type { ToolContext } from '@/lib/ai/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ouvre une session vocale et rend un jeton éphémère.
 *
 * Le navigateur ne voit jamais la clé de l'équipe : il reçoit un jeton qui ne
 * vaut que pour cette session, et l'URL à laquelle négocier sa connexion. Si le
 * fournisseur déplace un jour ce point d'entrée, une constante serveur change —
 * pas les navigateurs déjà ouverts.
 *
 * Le plafond de dépense est vérifié ICI, avant de rendre le jeton, parce que
 * c'est le dernier moment où le serveur a la main : ensuite, l'audio va
 * directement du navigateur au fournisseur, et plus rien ne passe par nous.
 */

const BodySchema = z.object({
  team_id: z.string().uuid(),
  project_id: z.string().uuid().nullable().optional(),
  form_id: z.string().uuid().nullable().optional()
});

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  // Une session vocale coûte plus cher qu'un message écrit : la cadence
  // d'ouverture est bornée plus serré.
  const limit = rateLimit(`ai-voice:${user.id}`, 6, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop d’ouvertures de session. Patientez un instant.' },
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
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  }

  const body = parsed.data;

  // Appartenance vérifiée explicitement, comme pour la conversation écrite :
  // `resolveAiRuntime` lit la clé en `service_role` et ne connaît pas
  // l'appelant.
  const { data: membership } = await createAdminClient()
    .from('team_members')
    .select('role')
    .eq('team_id', body.team_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: 'Espace de travail introuvable' }, { status: 404 });
  }

  const resolved = await resolveAiRuntime(body.team_id);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.reason }, { status: 409 });
  }

  const context: ToolContext = {
    supabase,
    teamId: body.team_id,
    userId: user.id,
    projectId: body.project_id ?? null,
    formId: body.form_id ?? null
  };

  const minted = await mintRealtimeSession(resolved.runtime, context);
  if (!minted.ok) {
    // 409 : ce n'est pas une panne du serveur, c'est une configuration ou une
    // indisponibilité chez le fournisseur, et la phrase doit s'afficher telle
    // quelle — elle propose la dictée.
    return NextResponse.json({ error: minted.reason }, { status: 409 });
  }

  return NextResponse.json({
    token: minted.session.token,
    sdp_url: minted.session.sdpUrl,
    model: minted.session.model,
    expires_at: minted.session.expiresAt,
    max_seconds: REALTIME_MAX_SECONDS
  });
}
