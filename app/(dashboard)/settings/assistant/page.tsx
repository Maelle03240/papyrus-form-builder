import type { Metadata } from 'next';

import { getActiveTeamId } from '@/lib/auth/active-team';
import { AssistantSettings } from './AssistantSettings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Assistant' };

export default async function AssistantSettingsPage() {
  const teamId = await getActiveTeamId();

  if (!teamId) {
    return (
      <p className="py-10 text-center text-sm text-text-secondary">
        Aucun espace de travail n’est associé à ce compte.
      </p>
    );
  }

  return <AssistantSettings teamId={teamId} />;
}
