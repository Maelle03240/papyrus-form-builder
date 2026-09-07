'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Plus, Tag, Trash2, TrendingUp } from 'lucide-react';

import { Switch } from '@/components/ui/Switch';
import { formatMoney, hasPricedFields, resolvePricing } from '@/lib/pricing';
import { cn } from '@/lib/utils';
import type {
  DiscountCode,
  Field,
  Form,
  PriceTier,
  PricingConfig,
  TieredPricing
} from '@/types';

/**
 * Onglet « Tarification » d'un formulaire.
 *
 * La devise et la TVA viennent du projet et sont affichées ici en lecture, avec
 * la possibilité de les surcharger : un formulaire qui facture dans une autre
 * monnaie que son projet est possible, mais ce doit être un geste délibéré, pas
 * un oubli.
 *
 * Les prix eux-mêmes ne se saisissent pas ici. Ils vivent sur les options, dans
 * l'onglet « Questions », parce que c'est l'option qui est vendue. Le récapitulatif
 * en bas de page dit où ils sont — sans lui, retrouver un prix dans un formulaire
 * de quarante questions oblige à toutes les ouvrir.
 */

interface Props {
  form: Form;
  onChange: (patch: Partial<Form>) => void;
  /** Lien vers l'onglet des questions, pour aller poser les prix. */
  buildHref: string;
}

const INPUT =
  'w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden';

export function FormPricingTab({ form, onChange, buildHref }: Props) {
  const config: PricingConfig = form.pricing_config ?? { enabled: false };
  const resolved = resolvePricing(form);
  const fields = form.fields ?? [];
  const priced = hasPricedFields(fields);

  const patch = (next: Partial<PricingConfig>) =>
    onChange({ pricing_config: { ...config, ...next } });

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <header>
        <h2 className="font-display text-lg font-bold text-text-primary">Tarification</h2>
        <p className="mt-1 text-sm leading-relaxed text-text-secondary">
          Le total se calcule pendant que le répondant remplit le formulaire, et se fige
          au moment de l&apos;envoi. Il ne bougera plus ensuite, même si les prix changent.
        </p>
      </header>

      <div className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-bg-surface p-4">
        <Switch checked={config.enabled === true} onChange={(enabled) => patch({ enabled })} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Afficher un total</p>
          <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
            Ajoute un récapitulatif chiffré à la fin du formulaire.
          </p>
        </div>
      </div>

      {config.enabled && (
        <div className="mt-6 space-y-8">
          {!priced && (
            <p className="rounded-xl border border-dashed border-border-strong bg-bg-base px-4 py-3 text-sm leading-relaxed text-text-secondary">
              Aucune question ne porte encore de prix : le total resterait à zéro.
              Posez un prix sur une option, ou faites compter un montant, dans{' '}
              <Link href={buildHref} className="font-medium text-accent hover:underline">
                l&apos;onglet Questions
              </Link>
              .
            </p>
          )}

          <Section
            title="Devise et TVA"
            hint="Héritées du projet, pour que tous ses formulaires facturent pareil."
          >
            <div className="grid grid-cols-2 gap-3">
              <Labelled label="Devise">
                <input
                  value={config.currency ?? ''}
                  onChange={(event) =>
                    patch({ currency: event.target.value.toUpperCase().slice(0, 4) })
                  }
                  placeholder={form.project_pricing?.currency ?? 'MUR'}
                  className={INPUT}
                />
                <Hint>Vide : celle du projet ({form.project_pricing?.currency ?? 'MUR'}).</Hint>
              </Labelled>

              <Labelled label="Position">
                <select
                  value={config.currency_position ?? ''}
                  onChange={(event) =>
                    patch({
                      currency_position:
                        event.target.value === ''
                          ? undefined
                          : (event.target.value as 'before' | 'after')
                    })
                  }
                  className={INPUT}
                >
                  <option value="">Celle du projet</option>
                  <option value="before">Avant — {formatMoney(1500, resolved.currency, 'before')}</option>
                  <option value="after">Après — {formatMoney(1500, resolved.currency, 'after')}</option>
                </select>
              </Labelled>
            </div>

            <div className="flex items-start gap-3 pt-1">
              <Switch
                checked={resolved.vat_enabled}
                onChange={(vat_enabled) => patch({ vat_enabled })}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary">Appliquer la TVA</p>
                {resolved.vat_enabled && (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <Labelled label="Taux (%)">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        value={config.vat_rate ?? form.project_pricing?.vat_rate ?? 15}
                        onChange={(event) => patch({ vat_rate: Number(event.target.value) })}
                        className={INPUT}
                      />
                    </Labelled>
                    <Labelled label="Libellé">
                      <input
                        value={config.vat_label ?? ''}
                        onChange={(event) => patch({ vat_label: event.target.value })}
                        placeholder="TVA"
                        className={INPUT}
                      />
                    </Labelled>
                  </div>
                )}
              </div>
            </div>
          </Section>

          <DiscountSection config={config} patch={patch} />

          <TieredSection config={config} patch={patch} fields={fields} currency={resolved.currency} />

          <Section title="Libellés du récapitulatif" hint="Vides, ils prennent leur valeur par défaut.">
            <div className="grid grid-cols-2 gap-3">
              <Labelled label="Sous-total">
                <input
                  value={config.subtotal_label ?? ''}
                  onChange={(event) => patch({ subtotal_label: event.target.value })}
                  placeholder="Sous-total"
                  className={INPUT}
                />
              </Labelled>
              <Labelled label="Total">
                <input
                  value={config.total_label ?? ''}
                  onChange={(event) => patch({ total_label: event.target.value })}
                  placeholder="Total"
                  className={INPUT}
                />
              </Labelled>
            </div>
          </Section>

          <PricedFieldsRecap fields={fields} currency={resolved.currency} buildHref={buildHref} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Codes de réduction
// ============================================================================

function DiscountSection({
  config,
  patch
}: {
  config: PricingConfig;
  patch: (next: Partial<PricingConfig>) => void;
}) {
  const discounts = config.discounts ?? [];

  const update = (id: string, next: Partial<DiscountCode>) =>
    patch({
      discounts: discounts.map((discount) =>
        discount.id === id ? { ...discount, ...next } : discount
      )
    });

  return (
    <Section
      title="Codes de réduction"
      hint="Une case apparaît sous le total ; la remise s'applique dès que le code correspond."
    >
      <div className="flex items-center gap-3">
        <Switch
          checked={config.discount_enabled === true}
          onChange={(discount_enabled) => patch({ discount_enabled })}
        />
        <span className="text-sm text-text-primary">Accepter les codes</span>
      </div>

      {config.discount_enabled && (
        <>
          {discounts.length === 0 && (
            <p className="rounded-md border border-dashed border-border-strong bg-bg-base px-3 py-2 text-xs text-text-tertiary">
              Aucun code : la case s&apos;affichera, mais rien ne la satisfera.
            </p>
          )}

          <div className="space-y-2">
            {discounts.map((discount, index) => (
              <div
                key={discount.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-bg-base p-2"
              >
                <Tag className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
                <input
                  value={discount.code}
                  onChange={(event) => update(discount.id, { code: event.target.value.trim() })}
                  placeholder="EARLY20"
                  aria-label={`Code ${index + 1}`}
                  className={cn(INPUT, 'py-1.5 font-mono uppercase')}
                />
                <div className="flex shrink-0 items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={discount.percent}
                    onChange={(event) =>
                      update(discount.id, { percent: Number(event.target.value) || 0 })
                    }
                    aria-label={`Remise du code ${index + 1}, en pourcentage`}
                    className={cn(INPUT, 'w-20 py-1.5 tabular-nums')}
                  />
                  <span className="text-sm text-text-tertiary">%</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    patch({ discounts: discounts.filter((item) => item.id !== discount.id) })
                  }
                  aria-label={`Supprimer le code ${index + 1}`}
                  className="shrink-0 rounded-md p-1.5 text-text-tertiary transition hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              patch({
                discounts: [
                  ...discounts,
                  { id: crypto.randomUUID(), code: '', percent: 10 }
                ]
              })
            }
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 py-2 text-xs text-text-secondary transition hover:border-accent hover:text-text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter un code
          </button>
        </>
      )}
    </Section>
  );
}

// ============================================================================
// Tarifs dégressifs
// ============================================================================

const EMPTY_TIERED: TieredPricing = {
  enabled: false,
  count_by: 'submission',
  tiers: [],
  after_last: 'keep'
};

function TieredSection({
  config,
  patch,
  fields,
  currency
}: {
  config: PricingConfig;
  patch: (next: Partial<PricingConfig>) => void;
  fields: Field[];
  currency: string;
}) {
  const tiered = config.tiered ?? EMPTY_TIERED;
  const tiers = tiered.tiers ?? [];
  const repeaters = fields.filter((field) => field.type === 'repeater');

  const patchTiered = (next: Partial<TieredPricing>) =>
    patch({ tiered: { ...tiered, ...next } });

  const updateTier = (index: number, next: Partial<PriceTier>) =>
    patchTiered({
      tiers: tiers.map((tier, position) => (position === index ? { ...tier, ...next } : tier))
    });

  return (
    <Section
      title="Tarif dégressif"
      hint="Le prix change avec le nombre d'inscriptions déjà enregistrées — le tarif « early bird » et ses suites."
    >
      <div className="flex items-center gap-3">
        <Switch
          checked={tiered.enabled}
          onChange={(enabled) => patchTiered({ enabled })}
        />
        <span className="text-sm text-text-primary">Appliquer un tarif par palier</span>
      </div>

      {tiered.enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Labelled label="Une inscription, c'est">
              <select
                value={tiered.count_by}
                onChange={(event) =>
                  patchTiered({ count_by: event.target.value as 'submission' | 'participant' })
                }
                className={INPUT}
              >
                <option value="submission">Une réponse</option>
                <option value="participant">Une ligne d&apos;un bloc répétable</option>
              </select>
            </Labelled>

            {tiered.count_by === 'participant' && (
              <Labelled label="Bloc compté">
                <select
                  value={tiered.participant_field_id ?? ''}
                  onChange={(event) =>
                    patchTiered({ participant_field_id: event.target.value || undefined })
                  }
                  className={INPUT}
                >
                  <option value="">Choisir…</option>
                  {repeaters.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label?.fr || 'Bloc sans titre'}
                    </option>
                  ))}
                </select>
                {repeaters.length === 0 && (
                  <Hint>Ce formulaire n&apos;a aucun bloc répétable.</Hint>
                )}
              </Labelled>
            )}
          </div>

          <Labelled label="Libellé de la ligne">
            <input
              value={tiered.registration_label ?? ''}
              onChange={(event) => patchTiered({ registration_label: event.target.value })}
              placeholder="Inscription"
              className={INPUT}
            />
          </Labelled>

          <div className="space-y-2">
            <span className="block text-xs text-text-secondary">Paliers</span>

            {tiers.map((tier, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-lg border border-border bg-bg-base p-2"
              >
                <TrendingUp className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
                <input
                  value={tier.label ?? ''}
                  onChange={(event) => updateTier(index, { label: event.target.value })}
                  placeholder={index === 0 ? 'Early bird' : `Palier ${index + 1}`}
                  aria-label={`Nom du palier ${index + 1}`}
                  className={cn(INPUT, 'py-1.5')}
                />
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-xs text-text-tertiary">jusqu&apos;à</span>
                  <input
                    type="number"
                    min={0}
                    value={tier.up_to ?? ''}
                    onChange={(event) =>
                      updateTier(index, {
                        up_to: event.target.value === '' ? null : Number(event.target.value)
                      })
                    }
                    placeholder="∞"
                    aria-label={`Seuil du palier ${index + 1}`}
                    className={cn(INPUT, 'w-20 py-1.5 tabular-nums')}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={tier.price}
                    onChange={(event) => updateTier(index, { price: Number(event.target.value) || 0 })}
                    aria-label={`Prix du palier ${index + 1}`}
                    className={cn(INPUT, 'w-24 py-1.5 tabular-nums')}
                  />
                  <span className="text-xs text-text-tertiary">{currency}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    patchTiered({ tiers: tiers.filter((_, position) => position !== index) })
                  }
                  aria-label={`Supprimer le palier ${index + 1}`}
                  className="shrink-0 rounded-md p-1.5 text-text-tertiary transition hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                patchTiered({ tiers: [...tiers, { up_to: null, price: 0, label: '' }] })
              }
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 py-2 text-xs text-text-secondary transition hover:border-accent hover:text-text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter un palier
            </button>

            <Hint>
              Le seuil est cumulé : « jusqu&apos;à 50 » signifie que le palier tient tant
              qu&apos;il y a moins de cinquante inscrits. Laissez-le vide pour « et au-delà ».
            </Hint>
          </div>

          <Labelled label="Passé le dernier palier">
            <select
              value={tiered.after_last}
              onChange={(event) =>
                patchTiered({ after_last: event.target.value as 'keep' | 'close' })
              }
              className={INPUT}
            >
              <option value="keep">Garder le dernier tarif</option>
              <option value="close">Fermer les inscriptions</option>
            </select>
          </Labelled>
        </>
      )}
    </Section>
  );
}

// ============================================================================
// Où sont les prix
// ============================================================================

function PricedFieldsRecap({
  fields,
  currency,
  buildHref
}: {
  fields: Field[];
  currency: string;
  buildHref: string;
}) {
  const rows = useMemo(() => {
    const out: { label: string; detail: string; price: number }[] = [];

    const collect = (
      candidates: { id: string; label?: { fr: string }; type: string; options?: { label?: { fr: string }; price?: number }[]; pricing?: { count_in_total?: boolean } }[],
      prefix = ''
    ) => {
      for (const field of candidates) {
        const name = field.label?.fr || 'Question sans titre';
        for (const option of field.options ?? []) {
          if (!option.price) continue;
          out.push({
            label: prefix ? `${prefix} — ${name}` : name,
            detail: option.label?.fr || 'Option',
            price: option.price
          });
        }
        if (field.pricing?.count_in_total && (field.type === 'number' || field.type === 'currency')) {
          out.push({
            label: prefix ? `${prefix} — ${name}` : name,
            detail: 'Le montant saisi',
            price: Number.NaN
          });
        }
      }
    };

    collect(fields);
    for (const field of fields) {
      if (field.repeater) collect(field.repeater.fields, field.label?.fr || 'Bloc');
    }

    return out;
  }, [fields]);

  if (rows.length === 0) return null;

  return (
    <Section title="Où sont les prix" hint="Ils se modifient dans l'onglet Questions, sur l'option concernée.">
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {rows.map((row, index) => (
          <li key={index} className="flex items-baseline justify-between gap-3 bg-bg-base px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-sm text-text-primary">{row.detail}</span>
              <span className="block truncate text-xs text-text-tertiary">{row.label}</span>
            </span>
            <span className="shrink-0 text-sm font-medium tabular-nums text-text-primary">
              {Number.isNaN(row.price) ? 'variable' : formatMoney(row.price, currency)}
            </span>
          </li>
        ))}
      </ul>
      <Link href={buildHref} className="text-xs font-medium text-accent hover:underline">
        Ouvrir l&apos;onglet Questions →
      </Link>
    </Section>
  );
}

// ============================================================================
// Petits éléments partagés
// ============================================================================

function Section({
  title,
  hint,
  children
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-text-tertiary">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-text-tertiary">{children}</p>;
}
