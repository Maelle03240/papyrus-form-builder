import type { Metadata } from 'next';

import { getActiveTeamId } from '@/lib/auth/active-team';
import { NewProjectWizard } from './NewProjectWizard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Nouveau projet' };

/**
 * L'assistant de création.
 *
 * Sous `/projects/nouveau` — un segment statique, qui l'emporte donc sur
 * `/projects/[id]`. « nouveau » n'est jamais un identifiant de projet : ce sont
 * des UUID.
 */
export default async function NewProjectPage() {
  const teamId = await getActiveTeamId();

  if (!teamId) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center text-sm text-text-secondary">
        Aucun espace de travail n’est associé à ce compte.
      </div>
    );
  }

  return <NewProjectWizard teamId={teamId} />;
}
