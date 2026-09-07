'use client';

import { Minus, Plus } from 'lucide-react';

import {
  clampQuantity,
  formatMoney,
  hasQuantityCounter,
  optionQuantity,
  quantityBounds,
  type QuantityMap
} from '@/lib/pricing';
import { cn } from '@/lib/utils';
import type { Field, FieldOption } from '@/types';

/**
 * Prix et quantités sur un champ à choix.
 *
 * Deux pièces, portées ensemble parce qu'elles répondent à la même question :
 * combien coûte ce que je viens de cocher.
 *
 * · le prix s'affiche **à côté de l'option**, là où on choisit. L'annoncer plus
 *   bas, dans le seul récapitulatif, obligerait à faire l'aller-retour pour
 *   comprendre pourquoi le total a bougé ;
 * · le compteur s'affiche **sous la liste**, une ligne par option retenue.
 *   Glissé dans chaque option, il doublerait la hauteur d'une liste de dix
 *   options dont une seule est cochée.
 */

export interface RendererPricing {
  enabled: boolean;
  currency: string;
  position: 'before' | 'after';
  quantities: QuantityMap;
  onQuantitiesChange?: (next: QuantityMap) => void;
}

/** Le prix d'une option, tel qu'il s'affiche à côté de son libellé. */
export function OptionPrice({
  option,
  pricing
}: {
  option: FieldOption;
  pricing?: RendererPricing;
}) {
  if (!pricing?.enabled || !option.price) return null;

  return (
    <span className="ml-1.5 whitespace-nowrap text-xs font-medium tabular-nums opacity-80">
      {formatMoney(option.price, pricing.currency, pricing.position)}
    </span>
  );
}

/**
 * Compteurs de quantité, une ligne par option retenue.
 *
 * N'affiche rien quand le champ n'a pas de compteur, ou quand rien n'est encore
 * coché : une rangée de boutons sans objet est du bruit.
 */
export function QuantityRow({
  field,
  value,
  pricing
}: {
  field: Field;
  value: unknown;
  pricing?: RendererPricing;
}) {
  if (!pricing?.enabled || !hasQuantityCounter(field) || !pricing.onQuantitiesChange) return null;

  const selectedIds = Array.isArray(value)
    ? value.map(String)
    : value != null && value !== ''
      ? [String(value)]
      : [];

  const options = (field.options ?? []).filter((option) => selectedIds.includes(option.id));
  if (options.length === 0) return null;

  const { min, max } = quantityBounds(field);

  const setQuantity = (optionId: string, next: number) => {
    pricing.onQuantitiesChange?.({
      ...pricing.quantities,
      [optionId]: clampQuantity(field, next)
    });
  };

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-bg-base p-2">
      {options.map((option) => {
        const quantity = optionQuantity(field, { [`${field.id}__qty`]: pricing.quantities }, option.id);
        const lineTotal = (option.price ?? 0) * quantity;

        return (
          <div key={option.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
              {option.label?.fr || 'Option'}
            </span>

            <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border-strong bg-bg-surface">
              <StepButton
                label={`Retirer un ${option.label?.fr || 'article'}`}
                disabled={quantity <= min}
                onClick={() => setQuantity(option.id, quantity - 1)}
              >
                <Minus className="h-3.5 w-3.5" />
              </StepButton>

              <span
                className="min-w-7 text-center text-sm font-semibold tabular-nums text-text-primary"
                aria-live="polite"
              >
                {quantity}
              </span>

              <StepButton
                label={`Ajouter un ${option.label?.fr || 'article'}`}
                disabled={quantity >= max}
                onClick={() => setQuantity(option.id, quantity + 1)}
              >
                <Plus className="h-3.5 w-3.5" />
              </StepButton>
            </div>

            {option.price ? (
              <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums text-text-primary">
                {formatMoney(lineTotal, pricing.currency, pricing.position)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'rounded-md p-1.5 text-text-secondary transition',
        disabled
          ? 'cursor-not-allowed opacity-30'
          : 'hover:bg-bg-elevated hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}
