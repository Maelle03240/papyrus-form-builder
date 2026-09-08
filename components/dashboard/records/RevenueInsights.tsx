'use client';

import { useMemo } from 'react';
import { Banknote, ShoppingBag, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { formatMoney } from '@/lib/pricing';
import { statusOf, summarize, type RecordRow } from '@/lib/records';

/**
 * Les indicateurs de tarification de l'onglet Analyse.
 *
 * Ils n'apparaissent que si des réponses portent des totaux : sur un sondage,
 * une carte « Facturé : 0,00 » suggère un réglage manqué là où il n'y a rien à
 * facturer.
 *
 * Le classement des lignes vendues sort du détail figé à l'envoi — la décision
 * de la phase 3 de conserver l'instantané ligne à ligne plutôt que le seul
 * total. C'est ce qui permet de répondre à « qu'est-ce qui se vend », six mois
 * plus tard, avec des prix modifiés entre-temps.
 */

const TOP_LINES = 6;

export function RevenueInsights({ submissions }: { submissions: RecordRow[] }) {
  const summary = useMemo(() => summarize(submissions), [submissions]);

  const byDay = useMemo(() => {
    const totals = new Map<string, number>();

    for (const row of submissions) {
      if (!row.pricing || statusOf(row) === 'void') continue;
      const day = row.completed_at.slice(0, 10);
      totals.set(day, (totals.get(day) ?? 0) + row.pricing.total);
    }

    return [...totals.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, amount]) => ({
        day,
        label: new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit'
        }),
        amount: Math.round(amount * 100) / 100
      }));
  }, [submissions]);

  const topLines = useMemo(() => {
    const totals = new Map<string, { amount: number; quantity: number }>();

    for (const row of submissions) {
      if (!row.pricing || statusOf(row) === 'void') continue;
      for (const line of row.pricing.lines) {
        const current = totals.get(line.label) ?? { amount: 0, quantity: 0 };
        current.amount += line.amount;
        current.quantity += line.quantity;
        totals.set(line.label, current);
      }
    }

    return [...totals.entries()]
      .map(([label, value]) => ({
        label,
        amount: Math.round(value.amount * 100) / 100,
        quantity: value.quantity
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, TOP_LINES);
  }, [submissions]);

  const revenue = summary.revenue;
  if (!revenue) return null;

  const money = (amount: number) =>
    formatMoney(amount, revenue.currency, revenue.currencyPosition);

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <MetricCard
          icon={Banknote}
          label="Facturé"
          value={money(revenue.billed)}
          hint={`${revenue.count} réponse${revenue.count > 1 ? 's' : ''} chiffrée${
            revenue.count > 1 ? 's' : ''
          }`}
        />
        <MetricCard
          icon={TrendingUp}
          label="Encaissé"
          value={money(revenue.collected)}
          hint={
            revenue.billed > 0
              ? `${Math.round((revenue.collected / revenue.billed) * 100)} % du facturé`
              : undefined
          }
        />
        <MetricCard
          icon={ShoppingBag}
          label="Panier moyen"
          value={money(revenue.average)}
          hint="hors réponses annulées"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {byDay.length > 1 && (
          <Panel title="Montant facturé par jour">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byDay} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-weak)" />
                <XAxis dataKey="label" stroke="var(--fg-tertiary)" fontSize={10} />
                <YAxis stroke="var(--fg-tertiary)" fontSize={10} width={56} />
                <Tooltip
                  formatter={(value) => [money(Number(value)), 'Facturé']}
                  contentStyle={{
                    fontSize: 11,
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border)'
                  }}
                />
                <Bar dataKey="amount" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        )}

        {topLines.length > 0 && (
          <Panel title="Ce qui rapporte le plus">
            {/* Un tableau plutôt qu'un graphique : ces lignes se lisent avec
                leur quantité ET leur montant, et deux séries sur un même axe se
                comparent mal quand l'une est en unités et l'autre en roupies. */}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-tertiary">
                  <th className="pb-2 font-normal">Ligne</th>
                  <th className="pb-2 text-right font-normal">Quantité</th>
                  <th className="pb-2 text-right font-normal">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topLines.map((line) => (
                  <tr key={line.label}>
                    <td className="max-w-[14rem] truncate py-2 text-text-primary" title={line.label}>
                      {line.label}
                    </td>
                    <td className="py-2 text-right tabular-nums text-text-secondary">
                      {line.quantity}
                    </td>
                    <td className="py-2 text-right tabular-nums font-medium text-text-primary">
                      {money(line.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </section>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-bg-surface p-6">
      <div className="shrink-0 rounded-full bg-accent/10 p-2.5">
        <Icon className="h-5 w-5 text-accent" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-secondary">{label}</p>
        <p className="mt-0.5 font-display text-2xl font-bold tabular-nums text-text-primary">
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-text-tertiary">{hint}</p>}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-6">
      <h3 className="mb-4 font-display text-sm font-semibold text-text-primary">{title}</h3>
      {children}
    </div>
  );
}
