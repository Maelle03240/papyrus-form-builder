import { NextResponse } from 'next/server';
import { getTemplateDefinition } from '@/lib/templates/generated';

/**
 * Définition complète d'un modèle, chargée à la demande.
 *
 * C'est ce qui permet de ne pas envoyer les ~600 Ko du catalogue au navigateur
 * pour afficher une grille de cartes : la galerie se contente de l'index, et ce
 * fichier-ci n'est demandé qu'à l'ouverture d'un aperçu ou au clic sur
 * « Utiliser ».
 *
 * Mêmes garanties que la route d'index : contenu statique du dépôt, aucune
 * donnée d'utilisateur, aucune requête Supabase.
 */
export async function GET(_request: Request, { params }: { params: { slug: string } }) {
  const def = getTemplateDefinition(params.slug);

  if (!def) {
    return NextResponse.json({ error: 'Modèle introuvable' }, { status: 404 });
  }

  return NextResponse.json(def, {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' }
  });
}
