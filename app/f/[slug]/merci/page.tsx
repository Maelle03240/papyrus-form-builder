import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Check } from 'lucide-react';
import { getPublicForm } from '@/lib/public-form';
import { pickText } from '@/lib/email/tokens';
import type { ConfirmationConfig } from '@/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
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
 *
 * Le titre et le message viennent du même réglage que l'écran du parcours
 * normal. Les jetons `{{…}}` n'y sont PAS résolus, et le numéro n'y figure
 * pas : arrivé par un signet, personne ne sait de quelle réponse il s'agit.
 */
export default async function ThankYouRoute({ params }: PageProps) {
  const { slug } = await params;
  const form = await getPublicForm(slug);

  if (!form) notFound();

  const accentColor = form.theme?.accent || '#052139';
  const config = (form.confirmation_config ?? {}) as ConfirmationConfig;
  const language = form.default_language || 'fr';
  const title = pickText(config.title, language) || 'Merci pour votre réponse !';
  const message =
    pickText(config.message, language) || 'Nous avons bien reçu vos informations.';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-base p-6 text-center">
      <div className="mx-auto w-full max-w-md space-y-6 rounded-2xl border border-border bg-bg-surface p-8 shadow-xs">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: accentColor }}
        >
          <Check className="h-8 w-8 text-white" />
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold text-text-primary">{title}</h1>
          <p className="text-sm text-text-secondary">{message}</p>
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
