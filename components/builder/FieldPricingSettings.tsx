'use client';

import { Switch } from '@/components/ui/Switch';
import { resolvePricing } from '@/lib/pricing';
import type { Field, FieldPricing, Form } from '@/types';

/**
 * Réglages de tarification d'un champ.
 *
 * Les prix eux-mêmes ne sont pas ici : ils vivent sur les options, éditables
 * directement sur la carte de la question, parce que c'est l'option qui est
 * vendue. Ce panneau ne porte que ce qui concerne le champ entier — sa
 * participation au total, et ses compteurs de quantité.
 *
 * Rien ne s'affiche tant que la tarification n'est pas activée dans l'onglet
 * dédié : un réglage de prix sur un formulaire qui n'en affiche pas ne ferait
 * qu'encombrer.
 */

interface Props {
  form: Form;
  field: Field;
  onChange: (patch: Partial<Field>) => void;
}

const INPUT =
  'w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-hidden';

export function FieldPricingSettings({ form, field, onChange }: Props) {
  const pricing = resolvePricing(form);
  if (!pricing.enabled) return null;

  const isAmount = field.type === 'number' || field.type === 'currency';
  const isCountable = field.type === 'single_choice' || field.type === 'multiple_choice';
  if (!isAmount && !isCountable) return null;

  const current: FieldPricing = field.pricing ?? {};
  const patch = (next: Partial<FieldPricing>) =>
    onChange({ pricing: { ...current, ...next } });

  const quantity = current.quantity ?? { enabled: false, min: 1, max: 99 };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Tarification
      </h3>

      {isAmount && (
        <div className="flex items-start gap-2">
          <Switch
            checked={current.count_in_total === true}
            onChange={(count_in_total) => patch({ count_in_total })}
          />
          <div className="min-w-0">
            <span className="text-xs text-text-secondary">Ajouter ce montant au total</span>
            <p className="mt-1 text-xs leading-relaxed text-text-tertiary">
              La valeur saisie par le répondant s&apos;ajoute au sous-total — un don libre,
              un supplément qu&apos;il chiffre lui-même.
            </p>
          </div>
        </div>
      )}

      {isCountable && (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Switch
              checked={quantity.enabled}
              onChange={(enabled) => patch({ quantity: { ...quantity, enabled } })}
            />
            <div className="min-w-0">
              <span className="text-xs text-text-secondary">Compteur de quantité</span>
              <p className="mt-1 text-xs leading-relaxed text-text-tertiary">
                Un « − 1 + » apparaît sous chaque option retenue, et son prix est multiplié
                par la quantité. « Trois tables de six » est une réponse, pas trois réponses.
              </p>
            </div>
          </div>

          {quantity.enabled && (
            <div className="grid grid-cols-2 gap-2 pl-9">
              <div className="space-y-1.5">
                <label className="block text-xs text-text-secondary">Minimum</label>
                <input
                  type="number"
                  min={1}
                  value={quantity.min}
                  onChange={(event) =>
                    patch({
                      quantity: {
                        ...quantity,
                        min: Math.max(1, Number(event.target.value) || 1)
                      }
                    })
                  }
                  className={INPUT}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs text-text-secondary">Maximum</label>
                <input
                  type="number"
                  min={quantity.min}
                  value={quantity.max}
                  onChange={(event) =>
                    patch({
                      quantity: {
                        ...quantity,
                        max: Math.max(quantity.min, Number(event.target.value) || quantity.min)
                      }
                    })
                  }
                  className={INPUT}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
