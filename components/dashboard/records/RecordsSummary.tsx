'use client';

import { formatSummaryMoney, type RecordsSummary as Summary } from '@/lib/records';
import { SUBMISSION_STATUS_LABELS, SUBMISSION_STATUSES } from '@/types';

/**
 * Les chiffres au-dessus du tableau.
 *
 * Ils portent sur les lignes FILTRÉES, pas sur l'ensemble : le tableau et le
 * bandeau doivent parler de la même chose, sinon on lit un chiffre d'affaires
 * qui ne correspond à rien de visible à l'écran.
 *
 * Les montants n'apparaissent que si des réponses en portent. Un sondage avec
 * une ligne « Facturé : 0,00 » suggère un problème de configuration là où il n'y
 * a rien à facturer.
 */
export function RecordsSummary({ summary }: { summary: Summary }) {
  const { revenue } = summary;

  return (
    <div className="flex flex-wrap items-stretch gap-x-8 gap-y-4 rounded-xl border border-border bg-bg-surface px-5 py-4">
      <Metric label="Réponses" value={String(summary.total)} />

      {/* Un statut absent n'occupe pas de place : sur un formulaire où rien
          n'est encore payé, une colonne « Payées : 0 » n'apprend rien. */}
      {SUBMISSION_STATUSES.filter((status) => summary.byStatus[status] > 0).map((status) => (
        <Metric
          key={status}
          label={SUBMISSION_STATUS_LABELS[status]}
          value={String(summary.byStatus[status])}
          muted
        />
      ))}

      {revenue && (
        <>
          <Divider />
          <Metric label="Facturé" value={formatSummaryMoney(revenue.billed, revenue)} />
          <Metric
            label="Encaissé"
            value={formatSummaryMoney(revenue.collected, revenue)}
            hint={
              revenue.billed > 0
                ? `${Math.round((revenue.collected / revenue.billed) * 100)} % du facturé`
                : undefined
            }
          />
          <Metric
            label="Panier moyen"
            value={formatSummaryMoney(revenue.average, revenue)}
            hint={`sur ${revenue.count} réponse${revenue.count > 1 ? 's' : ''}`}
            muted
          />
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  muted
}: {
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-text-tertiary">{label}</p>
      <p
        className={
          muted
            ? 'mt-0.5 text-lg tabular-nums text-text-secondary'
            : 'mt-0.5 font-display text-lg font-bold tabular-nums text-text-primary'
        }
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-text-tertiary">{hint}</p>}
    </div>
  );
}

function Divider() {
  return <div className="w-px self-stretch bg-border" aria-hidden="true" />;
}
