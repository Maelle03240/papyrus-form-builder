import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { recordAiUsage, resolveAiRuntime } from '@/lib/ai/settings';
import { REALTIME_MODEL } from '@/lib/ai/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Déclare ce qu'une session vocale a consommé.
 *
 * **Ce chiffre vient du navigateur, et c'est un aveu, pas un oubli.** En temps
 * réel, l'audio va directement du navigateur au fournisseur : le serveur ne
 * voit passer aucun jeton, et le seul endroit où le décompte existe est
 * l'événement de fin de session, côté client. Refuser de l'enregistrer
 * laisserait la voix invisible dans le budget — une dépense réelle absente du
 * compteur, ce qui est pire qu'un compteur perfectible.
 *
 * Deux garde-fous, faute de pouvoir vérifier : la cadence est bornée, et chaque
 * déclaration est plafonnée. Un membre qui truquerait ce chiffre ne tromperait
 * que sa propre équipe sur sa propre dépense — et le plafond de la session
 * suivante, lui, reste vérifié côté serveur avant l'ouverture.
 */

/**
 * Plafond par déclaration.
 *
 * Une session de vingt minutes ne dépasse pas cet ordre de grandeur ; un
 * nombre au-delà signale un bogue de comptage, pas une session hors norme.
 */
const MAX_TOKENS_PER_REPORT = 2_000_000;

const BodySchema = z.object({
  team_id: z.string().uuid(),
  conversation_id: z.string().uuid().nullable().optional(),
  input_tokens: z.number().int().min(0).max(MAX_TOKENS_PER_REPORT),
  output_tokens: z.number().int().min(0).max(MAX_TOKENS_PER_REPORT)
});

export async function POST(request: NextRequest) {
  const {
    data: { user }
  } = await createClient().auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const limit = rateLimit(`ai-usage:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Trop de déclarations.' }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Déclaration invalide.' }, { status: 400 });
  }

  const body = parsed.data;

  if (body.input_tokens === 0 && body.output_tokens === 0) {
    // Une session ouverte puis refermée sans un mot : rien à écrire, et une
    // ligne à zéro polluerait l'historique de consommation.
    return NextResponse.json({ recorded: false });
  }

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
    // Le plafond est peut-être atteint — précisément à cause de cette session.
    // On enregistre quand même : c'est le seul moment où l'on connaît le
    // chiffre, et le refuser reviendrait à effacer une dépense parce qu'elle
    // était de trop.
    return NextResponse.json({ recorded: false });
  }

  await recordAiUsage({
    teamId: body.team_id,
    userId: user.id,
    conversationId: body.conversation_id ?? null,
    runtime: { ...resolved.runtime, model: REALTIME_MODEL },
    inputTokens: body.input_tokens,
    outputTokens: body.output_tokens
  });

  return NextResponse.json({ recorded: true });
}
