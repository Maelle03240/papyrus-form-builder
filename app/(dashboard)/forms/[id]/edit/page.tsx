'use client';

import { useParams } from 'next/navigation';
import { FormBuilder } from '@/components/builder/FormBuilder';

/**
 * Ancienne adresse du constructeur, conservée le temps que les liens en
 * circulation migrent vers `/projects/[id]/forms/[formId]`.
 */
export default function BuilderPage() {
  const params = useParams<{ id: string }>();

  return (
    <FormBuilder
      formId={params.id}
      backHref="/forms"
      sharePath={`/forms/${params.id}?tab=share`}
    />
  );
}
