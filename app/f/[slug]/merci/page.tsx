import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Check } from 'lucide-react';
import { getPublicForm } from '@/lib/public-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { slug: string };
}

/**
 * Page de remerciement accessible par lien direct.
 *
 * Le parcours normal affiche l'écran de remerciement sans changer d'URL (il
 * peut porter le score du répondant). Cette page couvre le cas d'un accès
 * direct, par exemple depuis un signet.
 *
 * Elle lisait la table `forms` avec le client navigateur : même cause, même
 * conséquence que la page publique — un 404 systématique.
 */
export default async function ThankYouRoute({ params }: PageProps) {
  const form = await getPublicForm(params.slug);

  if (!form) notFound();

  const accentColor = form.theme?.accent || '#052139';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-base p-6 text-center">
      <div className="mx-auto w-full max-w-md space-y-6 rounded-2xl border border-border bg-bg-surface p-8 shadow-sm">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: accentColor }}
        >
          <Check className="h-8 w-8 text-white" />
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold text-text-primary">
            Merci pour votre réponse !
          </h1>
          <p className="text-sm text-text-secondary">
            Nous avons bien reçu vos informations.
          </p>
        </div>

        <div className="border-t border-border pt-4">
          <Link
            href={`/f/${form.slug}`}
            className="inline-block text-xs text-text-tertiary underline underline-offset-4 transition hover:text-text-secondary"
          >
            Retour au formulaire
          </Link>
        </div>
      </div>
    </div>
  );
}
