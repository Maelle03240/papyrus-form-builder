import { NextResponse } from 'next/server';
import { requireFormAccess } from '@/lib/auth/form-access';
import { GoogleApiError } from '@/lib/google/oauth';
import { resyncAllSubmissions } from '@/lib/integrations/google-sheets-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Une resynchronisation complète peut porter sur plusieurs milliers de lignes. */
export const maxDuration = 60;

/**
 * Réécrit l'onglet Google Sheets à partir des réponses en base.
 *
 * Utile après avoir rattaché une feuille à un formulaire qui a déjà collecté des
 * réponses, ou après une panne d'API : les envois qui n'ont pas pu être poussés
 * sont rattrapés d'un coup.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const guard = await requireFormAccess(params.id);
  if ('error' in guard) return guard.error;

  try {
    const result = await resyncAllSubmissions(params.id);
    return NextResponse.json({ success: true, rows: result.rows });
  } catch (error) {
    if (error instanceof GoogleApiError) {
      return NextResponse.json(
        { error: error.message, needsReconnect: error.needsReconnect },
        { status: error.status >= 500 ? 502 : error.status }
      );
    }
    console.error('Resynchronisation échouée:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }
}
