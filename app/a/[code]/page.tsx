import { notFound } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import type { Metadata } from 'next';

import { getPartnerLink } from '@/lib/partner-landing';
import { recordPartnerClick } from '@/lib/partners-server';
import { PartnerLanding } from '@/components/public/PartnerLanding';
import { VISITOR_COOKIE } from '@/lib/visitor';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ code: string }>;
}

/**
 * Page d'accueil d'un lien partenaire.
 *
 * Un code inconnu, un partenaire désactivé, un projet archivé ou un programme
 * éteint donnent tous le même 404 : la vue `public_partner_links` filtre les
 * quatre cas, et un message qui les distinguerait dirait à un curieux quels
 * codes existent.
 */
export default async function PartnerLandingPage({ params }: PageProps) {
  const { code } = await params;
  const link = await getPartnerLink(code);

  if (!link) notFound();

  // La visite est comptée ici, pendant le rendu.
  //
  // Le dédoublonnage (même visiteur, même demi-heure) est ce qui rend ce
  // compteur juste malgré les rendus multiples : un préchargement de lien, un
  // retour arrière ou un rafraîchissement ne comptent pas une visite de plus.
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  await recordPartnerClick(
    link.id,
    cookieStore.get(VISITOR_COOKIE)?.value ?? '',
    headerList.get('user-agent') ?? ''
  );

  return <PartnerLanding link={link} />;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const link = await getPartnerLink(code);

  if (!link) {
    return { title: 'Lien indisponible', robots: { index: false, follow: false } };
  }

  return {
    title: `${link.project_name} — ${link.partner_name}`,
    description: `Inscription à ${link.project_name}, avec ${link.partner_name}.`,
    // Pas d'indexation : ces pages sont nominatives, et une recherche sur le nom
    // du projet ne doit pas remonter la page d'un partenaire plutôt qu'une
    // autre — l'ordre des résultats deviendrait un avantage commercial que
    // personne n'a décidé.
    robots: { index: false, follow: false }
  };
}
