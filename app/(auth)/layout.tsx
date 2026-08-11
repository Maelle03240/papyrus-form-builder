import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Écrans d'authentification — vitrine de l'identité Mooove.
 *
 * Navy en fond (75 % du dosage de la charte), Cyan réservé au libellé de marque
 * et aux appels à l'action, aucun Ambre : la règle interdit d'associer Ambre et
 * Cyan dans un même bloc visuel.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Colonne de marque — masquée sur mobile pour laisser la place au formulaire */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-mooove-navy p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 0%, rgba(42,194,222,0.22), transparent 55%)'
          }}
        />

        <Link href="/" className="relative font-display text-3xl font-bold text-white">
          mooove
        </Link>

        <div className="relative max-w-md">
          <p className="mooove-label mb-4">Papyrus</p>
          <h2 className="font-display text-4xl font-bold leading-tight text-white">
            Pas une agence.
            <br />
            <span className="text-mooove-cyan">Un écosystème.</span>
          </h2>
          <p className="mt-6 text-lg text-mooove-sky">
            Construire, connecter, accélérer.{' '}
            <span className="font-bold text-mooove-cyan">MAINTENANT.</span>
          </p>
        </div>

        <p className="relative text-xs uppercase tracking-[0.12em] text-mooove-sky/70">
          We are not here to wait. We are here to move.
        </p>
      </aside>

      {/* Colonne formulaire */}
      <main className="flex items-center justify-center bg-bg-base px-6 py-12">
        <div className="w-full max-w-sm">
          <Link
            href="/"
            className="mb-10 block text-center font-display text-2xl font-bold text-mooove-navy lg:hidden"
          >
            mooove
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
