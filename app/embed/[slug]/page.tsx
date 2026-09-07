import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicForm } from '@/lib/public-form';
import { FormPublicView } from '@/components/public/FormPublicView';
import { ClosedFormPage } from '@/components/public/ClosedFormPage';
import { PasswordGate } from '@/components/public/PasswordGate';
import { parseEmbedOptions } from '@/lib/embed';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Version du formulaire destinée à être chargée dans une iframe.
 *
 * C'est bien la même vue que `/f/[slug]` : dupliquer le rendu du formulaire pour
 * l'intégration reviendrait à maintenir deux formulaires qui divergeraient au
 * premier changement. Seules l'enveloppe et quelques options changent, et elles
 * voyagent dans l'URL — un même formulaire peut donc être intégré deux fois avec
 * deux apparences différentes.
 *
 * Cette page n'est jamais indexée : c'est `/f/[slug]` qui est l'adresse
 * canonique du formulaire.
 */
export default async function FormEmbedPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const form = await getPublicForm(slug);

  if (!form) notFound();

  const embed = parseEmbedOptions(query);

  if (form.is_closed) return <ClosedFormPage form={form} />;

  if (form.requires_password) return <PasswordGate form={form} embed={embed} />;

  return <FormPublicView form={form} embed={embed} />;
}

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};
