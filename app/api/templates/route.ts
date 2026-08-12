import { NextResponse } from 'next/server';
import { TEMPLATE_INDEX } from '@/lib/templates/generated';

/**
 * Index léger du catalogue de modèles.
 *
 * `force-static` : le catalogue est versionné dans le dépôt, il ne change qu'au
 * déploiement. Aucune raison de recalculer cette réponse à chaque requête.
 *
 * Sécurité — cette route n'expose que du contenu statique du dépôt : aucune
 * donnée d'utilisateur, aucune requête Supabase, donc aucune surface RLS. Elle
 * reste volontairement accessible sans session. Ne jamais y ajouter de lecture
 * de `papyrus.forms`.
 */
export const dynamic = 'force-static';

export async function GET() {
  return NextResponse.json(TEMPLATE_INDEX, {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' }
  });
}
