import type { Metadata } from 'next';

import { getActiveTeamId } from '@/lib/auth/active-team';
import { PartnerDirectory } from './PartnerDirectory';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Partenaires' };

/**
 * L'annuaire des partenaires de l'espace de travail actif.
 *
 * L'espace est résolu côté serveur, et l'appartenance vérifiée : le cookie du
 * sélecteur d'espace ne fait pas foi.
 */
export default async function PartnersPage() {
  const teamId = await getActiveTeamId();

  if (!teamId) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-16 text-center text-sm text-text-secondary">
        Aucun espace de travail n’est associé à ce compte.
      </div>
    );
  }

  return <PartnerDirectory teamId={teamId} />;
}
