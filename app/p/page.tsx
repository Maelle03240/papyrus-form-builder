import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Handshake } from 'lucide-react';

import { listOwnPortals } from '@/lib/partner-portal';
import { PartnerSignIn } from '@/components/partner/PartnerSignIn';
import { portalPath } from '@/lib/partners';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Espace partenaire',
  robots: { index: false, follow: false }
};

/**
 * L'entrée sans jeton du portail partenaire.
 *
 * Elle existe parce qu'un lien se perd. Sans elle, un partenaire qui a effacé
 * son e-mail n'a plus aucun moyen d'entrer : le produit lui demanderait une
 * adresse qu'il ne connaît pas, et l'équipe devrait lui réémettre un accès pour
 * un compte qui fonctionne parfaitement.
 *
 * Un seul portail : on y va directement. Plusieurs — la même personne est
 * partenaire de deux équipes — : on choisit.
 */
export default async function PartnerHomePage() {
  const portals = await listOwnPortals();

  if (portals.length === 0) return <PartnerSignIn />;
  if (portals.length === 1) redirect(portalPath(portals[0].portal_token));

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-mooove-navy text-mooove-ice">
            <Handshake className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="mt-5 font-display text-2xl font-bold text-text-primary">
            Choisissez votre espace
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Vous êtes partenaire de plusieurs équipes. Chacune tient ses propres
            liens et ses propres commissions.
          </p>
        </div>

        <ul className="mt-8 space-y-3">
          {portals.map((portal) => (
            <li key={portal.id}>
              <Link
                href={portalPath(portal.portal_token)}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-bg-surface px-5 py-4 transition-colors hover:border-border-strong hover:bg-bg-elevated"
              >
                <span className="min-w-0 truncate font-medium text-text-primary">
                  {portal.name}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
