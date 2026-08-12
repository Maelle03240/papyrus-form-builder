import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { requireFormAccess } from '@/lib/auth/form-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Intégrations d'un formulaire.
 *
 * Passe par service_role parce que la configuration doit être relue et réécrite
 * en même temps que le journal des synchronisations, lui-même en lecture seule
 * côté client. Les droits de l'appelant sont vérifiés par `requireFormAccess`.
 */

const GoogleSheetsConfigSchema = z.object({
  spreadsheet_id: z.string().min(10).max(200),
  spreadsheet_name: z.string().max(300).optional(),
  spreadsheet_url: z.string().url().max(500).optional(),
  sheet_title: z.string().min(1).max(100),
  include_metadata: z.boolean().optional()
});

const UpsertSchema = z.object({
  provider: z.literal('google_sheets'),
  config: GoogleSheetsConfigSchema,
  is_active: z.boolean().optional()
});

/** Intégrations configurées + les 20 derniers évènements de synchronisation. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireFormAccess(params.id);
  if ('error' in guard) return guard.error;

  const admin = createAdminClient();

  const { data: integrations, error } = await admin
    .from('form_integrations')
    .select('*')
    .eq('form_id', params.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Lecture des intégrations échouée:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }

  const { data: events } = await admin
    .from('integration_events')
    .select('*')
    .eq('form_id', params.id)
    .order('created_at', { ascending: false })
    .limit(20);

  return NextResponse.json({
    integrations: integrations ?? [],
    events: events ?? [],
    teamId: guard.access.teamId
  });
}

/** Crée ou met à jour l'intégration d'un fournisseur (une seule par formulaire). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireFormAccess(params.id);
  if ('error' in guard) return guard.error;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const parsed = UpsertSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from('form_integrations')
    .upsert(
      {
        form_id: params.id,
        provider: parsed.data.provider,
        config: parsed.data.config,
        is_active: parsed.data.is_active ?? true,
        last_error: null,
        created_by: guard.access.userId,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'form_id,provider' }
    )
    .select()
    .single();

  if (error) {
    console.error('Enregistrement de l’intégration échoué:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }

  return NextResponse.json({ integration: data });
}

const PatchSchema = z.object({
  integrationId: z.string().uuid(),
  is_active: z.boolean()
});

/** Active ou désactive une intégration sans perdre sa configuration. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireFormAccess(params.id);
  if ('error' in guard) return guard.error;

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

  const { data, error } = await createAdminClient()
    .from('form_integrations')
    .update({ is_active: parsed.data.is_active, updated_at: new Date().toISOString() })
    .eq('id', parsed.data.integrationId)
    // Sans ce filtre, l'identifiant d'une intégration d'un autre formulaire
    // suffirait à la basculer.
    .eq('form_id', params.id)
    .select()
    .single();

  if (error) {
    console.error('Mise à jour de l’intégration échouée:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }

  return NextResponse.json({ integration: data });
}

/** Supprime une intégration. La feuille de calcul, elle, n'est pas touchée. */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireFormAccess(params.id);
  if ('error' in guard) return guard.error;

  const integrationId = new URL(request.url).searchParams.get('integrationId');
  if (!integrationId) {
    return NextResponse.json({ error: 'Paramètre integrationId manquant' }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from('form_integrations')
    .delete()
    .eq('id', integrationId)
    .eq('form_id', params.id);

  if (error) {
    console.error('Suppression de l’intégration échouée:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
