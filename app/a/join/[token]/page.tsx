import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { getPartnerJoin } from '@/lib/partner-landing';
import { PartnerJoinForm } from '@/components/public/PartnerJoinForm';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ token: string }>;
}

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

/**
 * Auto-inscription publique d'un partenaire — /a/join/<jeton>.
 *
 * Le lien est destiné à des prospects, donc la page ne dit du projet que son nom
 * et le texte que l'équipe a rédigé : ni chiffres, ni liste des partenaires
 * déjà inscrits, ni taux de commission tant que la relation n'existe pas.
 */
export default async function PartnerJoinPage({ params }: PageProps) {
  const { token } = await params;
  const project = await getPartnerJoin(token);

  if (!project) notFound();

  return <PartnerJoinForm project={project} />;
}
