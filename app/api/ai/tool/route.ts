import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { runTool, TOOLS_BY_NAME, type ToolContext } from '@/lib/ai/tools';
import { snapshotFormForAi } from '@/lib/ai/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exécute UN outil, pour la conversation vocale.
 *
 * En temps réel, le modèle parle directement au navigateur : ses demandes
 * d'outils arrivent donc là-bas, et non sur le serveur comme dans la
 * conversation écrite. Cette route est le retour au serveur — et la seule.
 *
 * **Elle n'accorde rien de nouveau.** L'outil s'exécute avec la session de
 * l'appelant, exactement comme dans la conversation écrite : la RLS décide, et
 * une personne qui appellerait cette route à la main depuis sa console ne
 * pourrait rien faire qu'elle ne puisse déjà faire en cliquant dans
 * l'application. Ce qui la protège n'est pas le secret de son existence, c'est
 * l'identité de celui qui l'appelle.
 *
 * L'instantané, lui, est pris ici : sans quoi une construction dictée à la voix
 * ne serait pas annulable, alors que la même construction écrite l'est.
 */

const BodySchema = z.object({
  team_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  /** Les arguments du modèle, validés par le schéma Zod de l'outil. */
  arguments: z.unknown().optional(),
  project_id: z.string().uuid().nullable().optional(),
  form_id: z.string().uuid().nullable().optional(),
  /** Vrai tant qu'aucun instantané n'a été pris dans cette session vocale. */
  snapshot: z.boolean().optional()
});

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  // Une conversation vocale enchaîne les outils vite : la limite est haute,
  // mais elle existe — une boucle du modèle ne doit pas écrire mille lignes.
  const limit = rateLimit(`ai-tool:${user.id}`, 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop d’actions d’affilée.' },
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

  const { data: membership } = await createAdminClient()
    .from('team_members')
    .select('role')
    .eq('team_id', body.team_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: 'Espace de travail introuvable' }, { status: 404 });
  }

  const context: ToolContext = {
    supabase,
    teamId: body.team_id,
    userId: user.id,
    projectId: body.project_id ?? null,
    formId: body.form_id ?? null
  };

  let versionId: string | null = null;
  const tool = TOOLS_BY_NAME.get(body.name);

  if (tool?.mutates && body.snapshot && context.formId) {
    const userName =
      (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'Assistant';
    versionId = await snapshotFormForAi(
      supabase,
      context.formId,
      'Avant la dictée',
      user.id,
      userName
    );
  }

  const result = await runTool(body.name, body.arguments ?? {}, context);

  return NextResponse.json({
    ok: result.ok,
    message: result.message,
    data: result.data ?? null,
    /** Renseigné à la première écriture : le panneau propose alors d'annuler. */
    version_id: versionId,
    /** L'ancrage a pu changer — l'assistant vient peut-être de créer le formulaire. */
    project_id: context.projectId,
    form_id: context.formId
  });
}
