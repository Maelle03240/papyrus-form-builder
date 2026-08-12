import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicForm } from '@/lib/public-form';
import { FormPublicView } from '@/components/public/FormPublicView';
import { ClosedFormPage } from '@/components/public/ClosedFormPage';
import { PasswordGate } from '@/components/public/PasswordGate';

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
 * Un formulaire encore en brouillon reste un 404 : annoncer « ce formulaire est
 * repassé en brouillon » à un visiteur anonyme reviendrait à divulguer
 * l'existence et l'état d'un formulaire privé. En revanche un formulaire publié
 * puis clos affiche désormais un message — le lien a circulé, la personne qui le
 * suit a droit à une explication.
 */
export default async function FormPublicPage({ params }: PageProps) {
  const form = await getPublicForm(params.slug);

  if (!form) notFound();

  if (form.is_closed) return <ClosedFormPage form={form} />;

  if (form.requires_password) return <PasswordGate form={form} />;

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
    // contrairement au reste de l'application. Un formulaire clos, en revanche,
    // n'a aucune raison de rester dans l'index.
    robots: form.is_closed ? { index: false, follow: false } : { index: true, follow: true }
  };
}
