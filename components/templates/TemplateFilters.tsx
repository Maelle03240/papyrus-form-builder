'use client';

import { cn } from '@/lib/utils';
import type { TemplateIndexEntry } from '@/lib/templates/types';

/**
 * Filtres secondaires, tous cumulables.
 *
 * Chacun se lit directement dans `TemplateIndexEntry` : aucun n'exige de charger
 * la définition complète d'un modèle, ce qui est précisément la raison d'être de
 * l'index.
 */

export type TemplateFilterKey =
  | 'logic'
  | 'scored'
  | 'matrix'
  | 'media'
  | 'file'
  | 'typeform';

export const FILTER_PREDICATES: Record<
  TemplateFilterKey,
  (entry: TemplateIndexEntry) => boolean
> = {
  logic: (e) => e.rule_count > 0,
  scored: (e) => e.scoring_enabled,
  matrix: (e) => e.has_matrix,
  media: (e) => e.has_media,
  file: (e) => e.has_file,
  typeform: (e) => e.display_mode === 'typeform'
};

const LABELS: { key: TemplateFilterKey; label: string }[] = [
  { key: 'logic', label: 'Avec logique conditionnelle' },
  { key: 'scored', label: 'Formulaire noté' },
  { key: 'matrix', label: 'Avec matrice' },
  { key: 'media', label: 'Avec image ou vidéo' },
  { key: 'file', label: 'Avec pièce jointe' },
  { key: 'typeform', label: 'Une question à la fois' }
];

interface Props {
  active: Set<TemplateFilterKey>;
  onToggle: (key: TemplateFilterKey) => void;
  onReset: () => void;
}

export function TemplateFilters({ active, onToggle, onReset }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {LABELS.map(({ key, label }) => {
        const on = active.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            aria-pressed={on}
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] transition',
              on
                ? 'bg-accent-cta/15 text-text-primary ring-1 ring-accent-cta'
                : 'border border-border text-text-tertiary hover:border-border-strong hover:text-text-secondary'
            )}
          >
            {label}
          </button>
        );
      })}

      {active.size > 0 && (
        <button
          type="button"
          onClick={onReset}
          className="ml-1 text-[11px] text-accent hover:underline"
        >
          Tout effacer
        </button>
      )}
    </div>
  );
}
