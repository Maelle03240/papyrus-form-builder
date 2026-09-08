import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { recordAiUsage, resolveAiRuntime } from '@/lib/ai/settings';
import { runAgentTurn, type AgentEvent } from '@/lib/ai/agent';
import type { ToolContext } from '@/lib/ai/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Un tour de conversation avec l'assistant.
 *
 * Le fil de la réponse est du SSE : le texte arrive mot à mot et chaque outil
 * exécuté est annoncé au passage. C'est ce qui rend l'attente supportable quand
 * l'assistant construit vingt questions — sans flux, l'écran resterait figé une
 * minute, et personne ne saurait s'il travaille ou s'il est mort.
 *
 * **Les outils s'exécutent avec la session de l'appelant**, jamais avec
 * `service_role`. La clé d'administration ne sert ici qu'à deux choses : lire
 * la clé d'API chiffrée de l'équipe, et écrire la ligne de consommation. Tout
 * ce que l'assistant touche passe par la RLS de la personne qui lui parle.
 */

const BodySchema = z.object({
  message: z.string().min(1).max(8000),
  team_id: z.string().uuid(),
  project_id: z.string().uuid().nullable().optional(),
  form_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional()
});

/** Nombre de messages d'historique rejoués au modèle. */
const HISTORY_LIMIT = 24;

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  // Un tour coûte de l'argent réel : la cadence est bornée par personne.
  const limit = rateLimit(`ai-chat:${user.id}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop de messages d’affilée. Patientez un instant.' },
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
    return NextResponse.json({ error: 'Message invalide.' }, { status: 400 });
  }

  const body = parsed.data;
  const admin = createAdminClient();

  // Appartenance vérifiée explicitement : `resolveAiRuntime` lit la clé de
  // l'équipe en `service_role`, et rien d'autre ne l'empêcherait de la lire
  // pour une équipe dont l'appelant n'est pas membre.
  const { data: membership } = await admin
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
    // 409 et non 500 : ce n'est pas une panne, c'est une configuration à faire,
    // et l'écran doit afficher la phrase telle quelle.
    return NextResponse.json({ error: resolved.reason }, { status: 409 });
  }

  // ── Conversation ──────────────────────────────────────────────────────────
  let conversationId = body.conversation_id ?? null;

  if (conversationId) {
    const { data: existing } = await supabase
      .from('ai_conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle();
    // La RLS a déjà filtré : une conversation d'une autre équipe revient nulle.
    if (!existing) conversationId = null;
  }

  if (!conversationId) {
    const { data: created } = await supabase
      .from('ai_conversations')
      .insert({
        team_id: body.team_id,
        user_id: user.id,
        project_id: body.project_id ?? null,
        form_id: body.form_id ?? null,
        title: body.message.slice(0, 80)
      })
      .select('id')
      .single();

    conversationId = created?.id ?? null;
  }

  const history: { role: 'user' | 'assistant'; content: string }[] = [];

  if (conversationId) {
    const { data: messages } = await supabase
      .from('ai_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);

    // Relu à l'envers puis remis à l'endroit : on veut les DERNIERS messages,
    // dans l'ordre. Trier à l'endroit avec une limite garderait les premiers.
    history.push(
      ...((messages ?? []) as { role: 'user' | 'assistant'; content: string }[])
        .reverse()
        .filter((entry) => entry.content.trim() !== '')
    );

    await supabase
      .from('ai_messages')
      .insert({ conversation_id: conversationId, role: 'user', content: body.message });
  }

  const context: ToolContext = {
    supabase,
    teamId: body.team_id,
    userId: user.id,
    projectId: body.project_id ?? null,
    formId: body.form_id ?? null
  };

  const userName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'Assistant';

  const encoder = new TextEncoder();
  let answer = '';
  const toolTrace: { name: string; ok: boolean; message: string }[] = [];
  let versionId: string | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for await (const event of runAgentTurn({
          runtime: resolved.runtime,
          context,
          history,
          message: body.message,
          userName
        })) {
          if (event.type === 'text') answer += event.delta;
          if (event.type === 'tool') toolTrace.push(event);
          if (event.type === 'snapshot') versionId = event.version_id;

          if (event.type === 'done') {
            await recordAiUsage({
              teamId: body.team_id,
              userId: user.id,
              conversationId,
              runtime: resolved.runtime,
              inputTokens: event.input_tokens,
              outputTokens: event.output_tokens
            });
          }

          send({ ...event, ...(event.type === 'done' ? { conversation_id: conversationId } : {}) } as AgentEvent);
        }

        if (conversationId) {
          await supabase.from('ai_messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: answer,
            tool_calls: toolTrace,
            version_id: versionId
          });
        }
      } catch (error) {
        console.error('Tour d’assistant en échec:', error);
        send({ type: 'error', message: 'La conversation s’est interrompue. Réessayez.' });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Sans cet en-tête, un proxy qui met la réponse en tampon annule tout
      // l'intérêt du flux : le texte arriverait d'un bloc, à la fin.
      'X-Accel-Buffering': 'no'
    }
  });
}
