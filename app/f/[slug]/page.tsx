import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicForm } from '@/lib/public-form';
import { FormPublicView } from '@/components/public/FormPublicView';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { slug: string };
}

/**
 * Page publique d'un formulaire.
 *
 * Elle interrogeait auparavant la table `forms` avec le client navigateur, ce
 * qui ne fonctionne plus depuis que la lecture anonyme passe par les vues
 * `public_*` : la requête ne renvoyait rien et toute page publique répondait 404.
 *
 * Les cas « brouillon » et « expiré » ne sont plus distingués ici : la vue ne
 * renvoie que les formulaires publiés et encore ouverts. Annoncer « ce
 * formulaire est repassé en brouillon » à un visiteur anonyme reviendrait de
 * toute façon à divulguer l'existence et l'état d'un formulaire privé.
 */
export default async function FormPublicPage({ params }: PageProps) {
  const form = await getPublicForm(params.slug);

  if (!form) notFound();

  return <FormPublicView form={form} />;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const form = await getPublicForm(params.slug);

  if (!form) {
    return { title: 'Formulaire indisponible', robots: { index: false, follow: false } };
  }

  return {
    title: form.title,
    description: form.description || `Répondre au formulaire ${form.title}`,
    // Un formulaire publié est destiné à être partagé : on autorise l'indexation,
    // contrairement au reste de l'application.
    robots: { index: true, follow: true }
  };
}
