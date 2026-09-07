'use client';

import { useMemo, useState } from 'react';
import { Check, TicketPercent, X } from 'lucide-react';

import { computeTotals, discountStatus, formatMoney, resolvePricing } from '@/lib/pricing';
import { cn } from '@/lib/utils';
import { DISCOUNT_CODE_KEY } from '@/types';
import type { Form } from '@/types';

/**
 * Récapitulatif chiffré affiché au répondant, juste avant le bouton d'envoi.
 *
 * Il montre le détail ligne à ligne, et pas seulement le total : un montant sans
 * explication se conteste, et c'est l'auteur du formulaire qui recevra l'appel.
 *
 * Les mêmes chiffres sont recalculés par le serveur à l'envoi, avec la même
 * fonction et sur les mêmes réponses. Ce que le répondant voit ici est donc
 * exactement ce qui sera figé sur sa réponse — il ne peut pas voir un montant et
 * en payer un autre.
 */

interface Props {
  form: Form;
  responses: Record<string, unknown>;
  updateResponse: (key: string, value: unknown) => void;
}

export function PricingSummary({ form, responses, updateResponse }: Props) {
  // `registered_count` est joint par la vue publique, et n'est renseigné que
  // lorsqu'un tarif dégressif est en place.
  const registeredCount = form.registered_count ?? 0;
  const pricing = resolvePricing(form);

  const totals = useMemo(
    () =>
      computeTotals(
        { fields: form.fields, sections: form.sections, logic_rules: form.logic_rules },
        responses,
        pricing,
        registeredCount
      ),
    [form.fields, form.sections, form.logic_rules, responses, pricing, registeredCount]
  );

  if (!pricing.enabled) return null;

  const money = (amount: number) =>
    formatMoney(amount, totals.currency, totals.currency_position);

  const nothingYet = totals.lines.length === 0 && !totals.registration;

  return (
    <section
      aria-label="Récapitulatif"
      className="rounded-xl border border-border bg-bg-surface p-5"
    >
      {/* Titre fixe : le libellé configurable appartient à la ligne du total, en
          bas. Les deux au même endroit se répétaient mot pour mot. */}
      <h3 className="font-display text-base font-bold text-text-primary">Récapitulatif</h3>

      {nothingYet ? (
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          Rien de facturable pour l&apos;instant. Le détail apparaîtra au fur et à mesure
          de vos choix.
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-2">
            {totals.registration && (
              <Line
                label={totals.registration.label}
                detail={[
                  totals.registration.tier_label,
                  totals.registration.units > 1
                    ? `${totals.registration.units} × ${money(totals.registration.unit_price)}`
                    : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
                amount={money(totals.registration.amount)}
              />
            )}

            {totals.lines.map((line, index) => (
              <Line
                key={`${line.field_id}-${index}`}
                label={line.detail || line.label}
                detail={[
                  line.detail ? line.label : '',
                  line.quantity > 1 ? `${line.quantity} × ${money(line.unit_price)}` : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
                amount={money(line.amount)}
              />
            ))}
          </ul>

          <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm">
            <Row label={totals.subtotal_label} value={money(totals.subtotal)} />

            {totals.discount > 0 && (
              <Row
                label={`${totals.discount_label} (${totals.discount_percent} %)`}
                value={`− ${money(totals.discount)}`}
                tone="positive"
              />
            )}

            {totals.vat > 0 && (
              <Row label={`${totals.vat_label} (${totals.vat_rate} %)`} value={money(totals.vat)} />
            )}

            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <dt className="font-display text-base font-bold text-text-primary">
                {totals.total_label}
              </dt>
              <dd className="font-display text-lg font-bold tabular-nums text-text-primary">
                {money(totals.total)}
              </dd>
            </div>
          </dl>
        </>
      )}

      {pricing.discount_enabled && (
        <DiscountField
          form={form}
          responses={responses}
          updateResponse={updateResponse}
          label={pricing.discount_code_label || 'Code de réduction'}
        />
      )}
    </section>
  );
}

function Line({
  label,
  detail,
  amount
}: {
  label: string;
  detail?: string;
  amount: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm text-text-primary">{label}</span>
        {detail && <span className="block text-xs text-text-tertiary">{detail}</span>}
      </span>
      <span className="shrink-0 text-sm tabular-nums text-text-primary">{amount}</span>
    </li>
  );
}

function Row({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: 'positive';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd
        className={cn(
          'tabular-nums',
          tone === 'positive' ? 'text-accent-bold' : 'text-text-primary'
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Saisie du code de réduction.
 *
 * Ce n'est pas une question du formulaire — donc pas un champ —, mais la valeur
 * voyage tout de même avec les réponses : c'est ainsi que l'enregistrement
 * automatique et la reprise d'une réponse en cours la retrouvent.
 */
function DiscountField({
  form,
  responses,
  updateResponse,
  label
}: {
  form: Form;
  responses: Record<string, unknown>;
  updateResponse: (key: string, value: unknown) => void;
  label: string;
}) {
  const [touched, setTouched] = useState(false);
  const code = String(responses[DISCOUNT_CODE_KEY] ?? '');
  const status = discountStatus(form.pricing_config ?? { enabled: false }, code);

  return (
    <div className="mt-4 border-t border-border pt-4">
      <label htmlFor="papyrus-discount" className="block text-xs text-text-secondary">
        {label}
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="relative flex-1">
          <TicketPercent
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
            aria-hidden="true"
          />
          <input
            id="papyrus-discount"
            value={code}
            onChange={(event) => {
              setTouched(true);
              updateResponse(DISCOUNT_CODE_KEY, event.target.value);
            }}
            placeholder="Votre code"
            autoComplete="off"
            className={cn(
              'w-full rounded-md border bg-bg-base py-2 pl-9 pr-3 text-sm uppercase tracking-wide text-text-primary',
              'placeholder:normal-case placeholder:tracking-normal placeholder:text-text-tertiary',
              'focus:outline-hidden',
              status === 'invalid' && touched
                ? 'border-danger focus:border-danger'
                : 'border-border-strong focus:border-accent'
            )}
          />
        </div>

        {status !== 'none' && touched && (
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 text-xs font-medium',
              status === 'valid' ? 'text-accent-bold' : 'text-danger'
            )}
            role="status"
          >
            {status === 'valid' ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Appliqué
              </>
            ) : (
              <>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Inconnu
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
