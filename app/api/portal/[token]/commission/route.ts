import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/server';
import { requirePartnerByToken } from '@/lib/partners-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  /** Vide = toutes les commissions dues du lien indiqué. */
  submission_ids: z.array(z.string().uuid()).max(500).optional(),
  project_partner_id: z.string().uuid().optional()
});

/**
 * Le partenaire confirme avoir été payé.
 *
 * Deux règles, appliquées ici parce que c'est le seul endroit que le partenaire
 * peut atteindre :
 *
 *  1. **La ligne doit lui appartenir.** Le filtre porte sur ses participations,
 *     jamais sur les identifiants reçus seuls — sinon coller l'identifiant de
 *     l'inscription d'un confrère suffirait à solder sa commission.
 *  2. **Le client doit avoir payé.** Confirmer la réception d'une commission sur
 *     une inscription impayée, c'est inscrire au registre un versement qui n'a
 *     pas eu lieu, et le faire disparaître de ce qui reste à verser.
 *
 * Il n'y a pas de retour en arrière côté partenaire : rouvrir une ligne qu'il a
 * lui-même confirmée est un geste de l'équipe, qui voit les deux côtés.
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
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: links } = await admin
    .from('project_partners')
    .select('id')
    .eq('partner_id', partner.id);

  const owned = new Set((links ?? []).map((row: { id: string }) => row.id));

  if (parsed.data.project_partner_id && !owned.has(parsed.data.project_partner_id)) {
    return NextResponse.json({ error: 'Lien introuvable.' }, { status: 404 });
  }

  const scope = parsed.data.project_partner_id
    ? [parsed.data.project_partner_id]
    : [...owned];

  if (scope.length === 0) {
    return NextResponse.json({ settled: 0 });
  }

  let query = admin
    .from('submissions')
    .update({ commission_paid_at: new Date().toISOString(), commission_paid_by: 'partner' })
    .in('project_partner_id', scope)
    .eq('status', 'paid')
    .is('commission_paid_at', null);

  if (parsed.data.submission_ids && parsed.data.submission_ids.length > 0) {
    query = query.in('id', parsed.data.submission_ids);
  }

  const { data, error } = await query.select('id');

  if (error) {
    console.error('Confirmation de commission échouée:', error);
    return NextResponse.json(
      { error: 'La confirmation n’a pas pu être enregistrée.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ settled: (data ?? []).length });
}
