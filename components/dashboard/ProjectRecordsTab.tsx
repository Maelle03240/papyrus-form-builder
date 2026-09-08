'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, FileText, ListChecks, MailWarning } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { RecordsFilters } from '@/components/dashboard/records/RecordsFilters';
import { RecordsSummary } from '@/components/dashboard/records/RecordsSummary';
import { StatusPill, StatusSelect } from '@/components/dashboard/records/StatusSelect';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/pricing';
import { formatAnswer } from '@/lib/submission-format';
import {
  EMPTY_FILTER,
  filterRecords,
  filterToParams,
  isFilterActive,
  statusOf,
  summarize,
  type RecordRow,
  type RecordsFilter
} from '@/lib/records';
import { cn } from '@/lib/utils';
import type { Form, SubmissionStatus } from '@/types';

/**
 * Onglet Réponses d'un projet — toutes ses inscriptions, tous formulaires
 * confondus.
 *
 * Le tableau ne montre PAS les questions : deux formulaires n'ont pas les mêmes,
 * et les juxtaposer produirait une grille creuse de trente colonnes dont
 * chacune ne concerne qu'une partie des lignes. Il montre ce que les réponses
 * ont en commun — quand, de quel formulaire, pour qui, combien, où ça en est —
 * et renvoie au formulaire pour le détail.
 *
 * L'export, lui, écrit un onglet par formulaire : c'est le seul endroit où les
 * questions de chacun peuvent coexister sans se mélanger.
 */

interface Props {
  forms: Form[];
  projectId: string;
}

export function ProjectRecordsTab({ forms, projectId }: Props) {
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RecordsFilter>({ ...EMPTY_FILTER });

  const formIds = useMemo(() => forms.map((form) => form.id), [forms]);
  const byId = useMemo(() => new Map(forms.map((form) => [form.id, form] as const)), [forms]);

  useEffect(() => {
    // Sans formulaire, il n'y a rien à charger — et le rendu n'atteint jamais
    // l'état de chargement : il s'arrête plus haut sur son propre message.
    if (formIds.length === 0) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await createClient()
          .from('submissions')
          .select(
            'id, form_id, responses, respondent_email, respondent_language, completed_at, is_partial, status, invoice_number, email_error, pricing'
          )
          .in('form_id', formIds)
          .order('completed_at', { ascending: false });
        if (error) throw error;
        if (!cancelled) setRows((data ?? []) as unknown as RecordRow[]);
      } catch (error) {
        console.error('Failed to load project submissions:', error);
        if (!cancelled) toast.error("Les réponses n'ont pas pu être chargées.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [formIds]);

  const partialCount = rows.filter((row) => row.is_partial).length;

  const languages = useMemo(
    () => Array.from(new Set(rows.map((row) => row.respondent_language || 'fr'))).sort(),
    [rows]
  );

  const visible = useMemo(
    () => filterRecords(rows, filter, { formOf: (row) => byId.get(row.form_id) }),
    [rows, filter, byId]
  );

  const summary = useMemo(() => summarize(visible), [visible]);
  const hasInvoiceNumbers = rows.some((row) => Boolean(row.invoice_number));
  const hasPricing = rows.some((row) => Boolean(row.pricing));

  async function handleStatusChange(id: string, status: SubmissionStatus) {
    const previous = rows.find((row) => row.id === id)?.status ?? 'submitted';
    const at = new Date().toISOString();

    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status } : row)));

    const { error } = await createClient()
      .from('submissions')
      .update({ status, status_updated_at: at })
      .eq('id', id);

    if (error) {
      console.error('Failed to update status:', error);
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status: previous } : row)));
      toast.error("Le statut n'a pas pu être changé.");
    }
  }

  /**
   * De quoi reconnaître une ligne sans ouvrir son formulaire.
   *
   * L'adresse e-mail d'abord — c'est ainsi qu'on désigne une inscription — puis,
   * à défaut, la première réponse texte non vide. Une ligne qui ne dirait que sa
   * date obligerait à toutes les ouvrir pour trouver la bonne.
   */
  function identify(row: RecordRow): string {
    if (row.respondent_email) return row.respondent_email;

    const form = byId.get(row.form_id);
    for (const field of form?.fields ?? []) {
      if (!['short_text', 'email', 'phone'].includes(field.type)) continue;
      const value = formatAnswer(field, row.responses?.[field.id], '', row.responses ?? {});
      if (value) return value;
    }
    return '—';
  }

  if (forms.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-sm text-text-secondary">
        Aucun formulaire, donc aucune réponse.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-6 py-10" aria-busy="true">
        <div className="h-9 w-full max-w-2xl animate-pulse rounded-md bg-bg-elevated" />
        <div className="mt-4 h-56 animate-pulse rounded-xl bg-bg-elevated" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-6 py-8">
        <div className="rounded-xl border border-dashed border-border-strong bg-bg-surface p-12 text-center">
          <ListChecks className="mx-auto h-10 w-10 text-text-tertiary" />
          <h3 className="mt-4 font-display text-lg font-bold text-text-primary">
            Aucune réponse dans ce projet
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
            Les réponses de tous les formulaires du projet se rassembleront ici.
          </p>
        </div>
      </div>
    );
  }

  const exportHref = `/api/projects/${projectId}/export?${filterToParams(filter).toString()}`;

  return (
    <div className="space-y-4 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-text-primary">
          Réponses du projet
        </h2>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Download className="h-3.5 w-3.5" />}
          disabled={visible.length === 0}
          onClick={() => window.open(exportHref, '_blank', 'noopener')}
        >
          {isFilterActive(filter)
            ? `Exporter ces ${visible.length} réponses`
            : 'Exporter en Excel'}
        </Button>
      </div>

      <RecordsFilters
        filter={filter}
        onChange={setFilter}
        languages={languages}
        forms={forms}
        partialCount={partialCount}
      />

      <RecordsSummary summary={summary} />

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong bg-bg-surface p-12 text-center">
          <p className="text-sm text-text-secondary">
            Aucune réponse ne correspond à ces filtres.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-surface">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-border bg-bg-elevated text-xs font-semibold uppercase text-text-secondary">
              <tr>
                <th className="px-4 py-3 min-w-[150px]">Date</th>
                <th className="px-4 py-3 min-w-[160px]">Formulaire</th>
                <th className="px-4 py-3 min-w-[180px]">Répondant</th>
                <th className="px-4 py-3 min-w-[120px]">Statut</th>
                {hasInvoiceNumbers && <th className="px-4 py-3 min-w-[110px]">Numéro</th>}
                {hasPricing && <th className="px-4 py-3 text-right min-w-[110px]">Total</th>}
                <th className="w-20 px-2 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((row) => {
                const form = byId.get(row.form_id);
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'transition-colors hover:bg-bg-elevated',
                      statusOf(row) === 'void' && 'opacity-55'
                    )}
                  >
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-text-secondary">
                      {new Date(row.completed_at).toLocaleString('fr-FR')}
                      {row.is_partial && (
                        <span
                          className="ml-2 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-warning"
                          title="Ébauche : le formulaire n'a jamais été envoyé"
                        >
                          partielle
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-primary">
                      <Link
                        href={`/projects/${projectId}/forms/${row.form_id}?tab=records`}
                        className="transition hover:text-accent hover:underline"
                      >
                        {form?.title || 'Formulaire supprimé'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      <span className="block max-w-[16rem] truncate" title={identify(row)}>
                        {identify(row)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {row.is_partial ? (
                        <StatusPill value="submitted" />
                      ) : (
                        <StatusSelect
                          value={statusOf(row)}
                          onChange={(status) => void handleStatusChange(row.id, status)}
                          label={`Statut de la réponse de ${identify(row)}`}
                        />
                      )}
                    </td>
                    {hasInvoiceNumbers && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.invoice_number ? (
                          <span className="inline-flex items-center gap-2 font-mono text-xs font-medium text-text-primary">
                            {row.invoice_number}
                            {row.email_error && (
                              <MailWarning
                                className="h-3.5 w-3.5 shrink-0 text-warning"
                                aria-label={`E-mail non envoyé : ${row.email_error}`}
                              />
                            )}
                          </span>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                    )}
                    {hasPricing && (
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums text-text-primary">
                        {row.pricing ? (
                          formatMoney(
                            row.pricing.total,
                            row.pricing.currency,
                            row.pricing.currency_position
                          )
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                    )}
                    <td className="w-20 px-2 py-3 text-right">
                      {!row.is_partial && (
                        <a
                          href={`/api/submissions/${row.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={
                            row.invoice_number
                              ? `Ouvrir le bon de commande ${row.invoice_number}`
                              : 'Ouvrir le récapitulatif en PDF'
                          }
                          className="inline-flex text-text-tertiary transition-colors hover:text-accent"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
