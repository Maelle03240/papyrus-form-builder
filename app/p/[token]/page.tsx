import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { loadPortal } from '@/lib/partner-portal';
import { PartnerPortal } from '@/components/partner/PartnerPortal';
import { PartnerSignIn } from '@/components/partner/PartnerSignIn';
import { portalPath } from '@/lib/partners';
import { APP_URL } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Espace partenaire',
  robots: { index: false, follow: false }
};

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Le portail d'un partenaire — /p/<jeton>.
 *
 * Le jeton dit DE QUI est ce portail ; la session dit qui frappe. Un lien
 * transmis à un tiers n'ouvre donc rien : il affiche l'écran de connexion, et
 * après connexion, le portail de la personne connectée n'apparaît que si le
 * jeton est le sien.
 */
export default async function PartnerPortalPage({ params }: PageProps) {
  const { token } = await params;
  const portal = await loadPortal(token);

  // Deux cas, un seul écran. « Ce portail n'existe pas » et « ce portail n'est
  // pas le vôtre » se répondent de la même façon, sans quoi essayer des jetons
  // au hasard dirait lesquels existent.
  if (portal.state !== 'ok') {
    return <PartnerSignIn redirectTo={portalPath(token)} />;
  }

  return (
    <PartnerPortal
      partner={portal.partner}
      links={portal.links}
      registrations={portal.registrations}
      openProjects={portal.openProjects}
      origin={await publicOrigin()}
    />
  );
}

/**
 * L'origine à afficher dans les liens copiables.
 *
 * `NEXT_PUBLIC_APP_URL` d'abord, en-têtes du proxy ensuite : derrière Easypanel,
 * le serveur Next croit s'appeler `0.0.0.0:80`, et un partenaire à qui l'on
 * ferait copier ce lien-là le collerait dans un e-mail où il ne mènerait nulle
 * part.
 */
async function publicOrigin(): Promise<string> {
  if (APP_URL && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(APP_URL)) {
    return APP_URL.replace(/\/$/, '');
  }

  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
  if (host && !host.startsWith('0.0.0.0')) {
    return `${headerList.get('x-forwarded-proto') ?? 'https'}://${host}`;
  }

  return (APP_URL ?? '').replace(/\/$/, '');
}
