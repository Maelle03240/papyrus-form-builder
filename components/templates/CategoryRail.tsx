'use client';

import { cn } from '@/lib/utils';

/**
 * Rail de catégories, collant sous l'en-tête.
 *
 * L'ordre est imposé et non alphabétique : il suit celui du catalogue, qui va du
 * plus courant (contact, recrutement) au plus spécialisé (conformité). Une
 * catégorie absente du catalogue n'apparaît pas — le rail se règle sur les
 * données, pas sur une liste écrite deux fois.
 */

export const CATEGORY_ORDER = [
  'Contact & Leads',
  'RH & Recrutement',
  'Vie interne',
  'Satisfaction client',
  'Produit & Recherche',
  'Événements',
  'Marketing & Agence',
  'Réservations & Voyage',
  'Éducation & Quiz',
  'Opérations & Conformité'
];

export const ALL_CATEGORIES = '__all__';

interface Props {
  counts: Record<string, number>;
  total: number;
  active: string;
  onSelect: (category: string) => void;
}

export function CategoryRail({ counts, total, active, onSelect }: Props) {
  const categories = CATEGORY_ORDER.filter((c) => (counts[c] ?? 0) > 0);

  return (
    <div className="sticky top-0 z-20 -mx-1 bg-bg-base/90 px-1 py-3 backdrop-blur">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Pill
          label="Toutes"
          count={total}
          active={active === ALL_CATEGORIES}
          onClick={() => onSelect(ALL_CATEGORIES)}
        />
        {categories.map((category) => (
          <Pill
            key={category}
            label={category}
            count={counts[category] ?? 0}
            active={active === category}
            onClick={() => onSelect(category)}
          />
        ))}
      </div>
    </div>
  );
}

function Pill({
  label,
  count,
  active,
  onClick
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'bg-mooove-navy text-mooove-ice'
          : 'border border-border text-text-secondary hover:border-border-strong hover:text-text-primary'
      )}
    >
      {label}
      <span className={cn('text-[10px]', active ? 'opacity-70' : 'text-text-tertiary')}>
        {count}
      </span>
    </button>
  );
}
