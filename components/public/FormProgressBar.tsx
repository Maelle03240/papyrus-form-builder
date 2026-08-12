'use client';

import { useMemo } from 'react';
import type { Field, Form } from '@/types';

/**
 * Barre de progression du répondant.
 *
 * Elle compte les questions effectivement visibles — une question masquée par
 * une règle logique ne doit pas peser dans un total qu'on n'atteindra jamais.
 * Les blocs décoratifs (titre de section, texte, image, vidéo) n'entrent pas
 * davantage dans le calcul.
 */
export function FormProgressBar({
  form,
  responses,
  visibleFields
}: {
  form: Form;
  responses: Record<string, unknown>;
  visibleFields: Set<string>;
}) {
  const percent = useMemo(() => {
    const countable = (form.fields ?? []).filter(
      (field: Field) =>
        visibleFields.has(field.id) &&
        !['section_break', 'statement', 'image', 'video'].includes(field.type)
    );

    if (countable.length === 0) return 0;

    const answered = countable.filter((field) => {
      const value = responses[field.id];
      if (value === undefined || value === null) return false;
      if (typeof value === 'string') return value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value as object).length > 0;
      return true;
    }).length;

    return Math.round((answered / countable.length) * 100);
  }, [form.fields, responses, visibleFields]);

  return (
    <div
      className="sticky top-0 z-30 h-1.5 w-full bg-black/5 print:hidden"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progression du formulaire"
    >
      <div
        className="h-full transition-[width] duration-300 ease-out"
        style={{ width: `${percent}%`, backgroundColor: form.theme.accent || '#052139' }}
      />
    </div>
  );
}
