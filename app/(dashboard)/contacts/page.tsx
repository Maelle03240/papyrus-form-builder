import type { Metadata } from 'next';

import { getActiveTeamId } from '@/lib/auth/active-team';
import { ContactBook } from './ContactBook';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Contacts' };

export default async function ContactsPage() {
  const teamId = await getActiveTeamId();

  if (!teamId) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-16 text-center text-sm text-text-secondary">
        Aucun espace de travail n’est associé à ce compte.
      </div>
    );
  }

  return <ContactBook teamId={teamId} />;
}
