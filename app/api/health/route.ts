import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sonde de santé — consommée par le HEALTHCHECK Docker et par Uptime Kuma.
 *
 * Elle vérifie que la base répond réellement, et pas seulement que le process
 * Node est vivant : une application qui a perdu Supabase renvoie 200 sur toutes
 * ses pages tout en étant inutilisable.
 *
 * Aucune information sensible n'est exposée : ni URL, ni version, ni détail
 * d'erreur — juste un état.
 */
export async function GET() {
  const checks: Record<string, 'ok' | 'error'> = {};

  try {
    const { error } = await createAdminClient()
      .from('app_settings')
      .select('id', { head: true, count: 'exact' })
      .limit(1);

    checks.database = error ? 'error' : 'ok';
  } catch {
    checks.database = 'error';
  }

  // Le stockage média est déclaré configuré si les variables sont présentes ;
  // on ne contacte pas R2 à chaque sonde pour ne pas consommer de quota.
  checks.mediaStorage =
    process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY ? 'ok' : 'error';

  const healthy = Object.values(checks).every((state) => state === 'ok');

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks },
    { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  );
}
