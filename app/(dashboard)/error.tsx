'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Filet de sécurité de l'application.
 *
 * Il n'existait aucune frontière d'erreur : la moindre exception pendant le
 * rendu laissait une page entièrement blanche, sans barre d'outils, sans lien,
 * sans rien — impossible de revenir à son formulaire autrement qu'en tapant une
 * URL à la main. Un bug d'affichage se transformait ainsi en travail
 * apparemment perdu.
 *
 * Cet écran ne corrige aucune cause : il garantit qu'il reste toujours une
 * sortie, et que l'erreur est visible plutôt que silencieuse.
 */
export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Erreur de rendu:', error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning/10">
        <AlertTriangle className="h-6 w-6 text-warning" />
      </div>

      <h1 className="mt-5 font-display text-2xl">Cet écran n&apos;a pas pu s&apos;afficher</h1>
      <p className="papyrus-meta mt-2 text-sm">
        i. Vos données ne sont pas perdues — seul l&apos;affichage a échoué. Réessayez, ou
        revenez à la liste de vos formulaires.
      </p>

      {error.digest && (
        <p className="mt-3 font-mono text-[11px] text-text-tertiary">
          Référence : {error.digest}
        </p>
      )}

      <div className="mt-6 flex items-center gap-2">
        <Button onClick={reset} iconLeft={<RotateCcw className="h-4 w-4" />}>
          Réessayer
        </Button>
        <Link href="/forms">
          <Button variant="secondary">Mes formulaires</Button>
        </Link>
      </div>
    </div>
  );
}
