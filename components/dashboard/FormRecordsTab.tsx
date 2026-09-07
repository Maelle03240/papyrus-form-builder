'use client';

import { useState } from 'react';
import { Check, Copy, Download, ListChecks, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Field, Form } from '@/types';
import { formatMoney, resolvePricing } from '@/lib/pricing';
import { isAnswerable } from '@/lib/submission-format';

/**
 * Onglet Réponses — le tableau brut : recherche, export, édition en ligne,
 * suppression.
 *
 * S'appelait « ResponsesTab » et vivait dans la page `/forms/[id]`.
 */
interface FormRecordsTabProps {
  form: Form;
  submissions: any[];
  setSubmissions: React.Dispatch<React.SetStateAction<any[]>>;
  loading: boolean;
}

export function FormRecordsTab({ form, submissions: allSubmissions, setSubmissions, loading }: FormRecordsTabProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ subId: string; fieldId: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editedCells, setEditedCells] = useState<Set<string>>(new Set());
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [showPartials, setShowPartials] = useState(false);

  const partialCount = allSubmissions.filter((s) => s.is_partial).length;

  // Par défaut, le tableau ne montre que les réponses abouties : c'est ce qu'on
  // exporte, ce qu'on compte, et ce que l'auteur du formulaire appelle « une
  // réponse ». Les ébauches sont accessibles d'un clic, jamais mélangées sans
  // qu'on l'ait demandé.
  const submissions = showPartials
    ? allSubmissions
    : allSubmissions.filter((s) => !s.is_partial);

  const fields = (form.fields ?? []).filter(isAnswerable);
  const pricingEnabled = resolvePricing(form).enabled;

  function renderResponseValue(field: Field, value: any): string {
    if (value === undefined || value === null || value === '') return '—';

    if (['single_choice', 'multiple_choice', 'dropdown'].includes(field.type)) {
      const getOptionLabel = (optId: string) => {
        const option = field.options?.find((o: any) => o.id === optId);
        return option ? (option.label.fr || option.label.en || optId) : optId;
      };
      if (Array.isArray(value)) return value.map(getOptionLabel).join(', ');
      if (typeof value === 'string') {
        if (value.includes(',') && !field.options?.some((o: any) => o.id === value)) {
          return value.split(',').map((v) => getOptionLabel(v.trim())).join(', ');
        }
        return getOptionLabel(value);
      }
    }

    if (field.type === 'matrix') {
      if (typeof value === 'object') {
        return Object.entries(value)
          .map(([rowId, colId]) => {
            const row = field.rows?.find((r: any) => r.id === rowId);
            const col = field.options?.find((c: any) => c.id === colId as string);
            const rowLabel = row ? (row.label.fr || row.label.en || rowId) : rowId;
            const colLabel = col ? (col.label.fr || col.label.en || colId) : colId;
            return `${rowLabel} : ${colLabel}`;
          })
          .join(' | ');
      }
    }

    if (typeof value === 'object') {
      if (Array.isArray(value)) return value.join(', ');
      return JSON.stringify(value);
    }
    return String(value);
  }

  async function handleDelete(subId: string) {
    const supabase = createClient();
    const { error } = await supabase.from('submissions').delete().eq('id', subId);
    if (!error) {
      setSubmissions((prev) => prev.filter((s) => s.id !== subId));
      toast.success('Réponse supprimée');
    } else {
      console.error('Failed to delete submission:', error);
      toast.error('Erreur lors de la suppression');
    }
    setConfirmDeleteId(null);
  }

  async function handleCopyCell(text: string, cellKey: string) {
    if (text === '—') return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCell(cellKey);
      setTimeout(() => setCopiedCell(null), 1500);
    } catch {
      toast.error('Impossible de copier');
    }
  }

  function startEdit(subId: string, fieldId: string, renderedValue: string) {
    setEditingCell({ subId, fieldId });
    setEditValue(renderedValue === '—' ? '' : renderedValue);
  }

  async function saveEdit() {
    if (!editingCell) return;
    const { subId, fieldId } = editingCell;
    const sub = submissions.find((s) => s.id === subId);
    if (!sub) { setEditingCell(null); return; }

    const newResponses = { ...(sub.responses ?? {}), [fieldId]: editValue };
    const supabase = createClient();
    const { error } = await supabase
      .from('submissions')
      .update({ responses: newResponses })
      .eq('id', subId);

    if (!error) {
      setSubmissions((prev) =>
        prev.map((s) => (s.id === subId ? { ...s, responses: newResponses } : s))
      );
      setEditedCells((prev) => new Set([...prev, `${subId}:${fieldId}`]));
    } else {
      console.error('Failed to update submission:', error);
      toast.error('Erreur lors de la modification');
    }
    setEditingCell(null);
  }

  const handleExportExcel = () => {
    import('xlsx').then((XLSX) => {
      const data = submissions.map((sub) => {
        const row: Record<string, any> = {};
        fields.forEach((f) => {
          const headerName = f.label.fr || 'Champ sans nom';
          row[headerName] = renderResponseValue(f, sub.responses?.[f.id]);
        });
        row['Date de soumission'] = new Date(sub.completed_at).toLocaleString('fr-FR');
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Réponses');

      const slugTitle = form.title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
      const dateStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `${slugTitle}-reponses-${dateStr}.xlsx`);
    });
  };

  if (loading) {
    return <div className="py-12 text-center papyrus-meta text-sm">Chargement des réponses...</div>;
  }

  const partialToggle = partialCount > 0 && (
    <button
      type="button"
      onClick={() => setShowPartials((v) => !v)}
      className="text-xs text-accent hover:underline"
    >
      {showPartials
        ? 'Masquer les réponses partielles'
        : `Afficher les ${partialCount} réponse${partialCount > 1 ? 's' : ''} partielle${partialCount > 1 ? 's' : ''}`}
    </button>
  );

  if (submissions.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="font-display text-xl">Réponses brutes</h2>
        <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-12 text-center">
          <ListChecks className="mx-auto h-10 w-10 text-text-tertiary" />
          <h3 className="mt-4 font-display text-xl">Aucune réponse pour l&apos;instant</h3>
          <p className="papyrus-meta mx-auto mt-1 max-w-md text-sm">
            i. Partagez le lien de votre formulaire pour commencer à collecter des réponses.
          </p>
          {partialToggle && <div className="mt-4">{partialToggle}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-xl">Réponses brutes ({submissions.length})</h2>
          {partialToggle}
        </div>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Download className="h-3.5 w-3.5" />}
          onClick={handleExportExcel}
        >
          Exporter Excel
        </Button>
      </div>

      <div className="w-full overflow-x-auto rounded-lg border border-border bg-bg-surface">
        <table className="w-full border-collapse text-left text-sm text-text-primary">
          <thead className="border-b border-border bg-bg-elevated text-xs font-semibold uppercase text-text-secondary">
            <tr>
              <th className="w-8 px-2 py-3" />
              <th className="px-4 py-3 min-w-[150px]">Date de soumission</th>
              {pricingEnabled && <th className="px-4 py-3 text-right min-w-[110px]">Total</th>}
              {fields.map((f) => (
                <th key={f.id} className="px-4 py-3 min-w-[200px] max-w-[350px] truncate">
                  {f.label.fr || 'Champ sans nom'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {submissions.map((sub) => (
              <tr
                key={sub.id}
                className={cn(
                  'group/row hover:bg-bg-elevated transition-colors',
                  confirmDeleteId === sub.id && 'bg-danger/5'
                )}
              >
                {/* Colonne suppression */}
                <td className="w-8 px-2 py-3">
                  {confirmDeleteId === sub.id ? (
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <button
                        onClick={() => handleDelete(sub.id)}
                        className="text-[11px] font-semibold text-danger hover:underline"
                      >
                        Oui
                      </button>
                      <span className="text-[11px] text-text-tertiary">/</span>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[11px] text-text-secondary hover:underline"
                      >
                        Non
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(sub.id)}
                      className="invisible group-hover/row:visible text-text-tertiary hover:text-danger transition-colors"
                      title="Supprimer cette réponse"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>

                {/* Date */}
                <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-text-secondary">
                  {new Date(sub.completed_at).toLocaleString('fr-FR')}
                  {sub.is_partial && (
                    <span
                      className="ml-2 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-warning"
                      title="Ébauche : le formulaire n'a jamais été envoyé"
                    >
                      partielle
                    </span>
                  )}
                </td>

                {/* Total figé à l'envoi.
                    Il n'est jamais recalculé à l'affichage : c'est le montant
                    que le répondant a vu, même si les prix ont changé depuis. */}
                {pricingEnabled && (
                  <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                    {sub.pricing
                      ? formatMoney(
                          sub.pricing.total,
                          sub.pricing.currency,
                          sub.pricing.currency_position
                        )
                      : <span className="text-text-tertiary">—</span>}
                  </td>
                )}

                {/* Cellules de réponse */}
                {fields.map((f) => {
                  const val = sub.responses?.[f.id];
                  const renderedVal = renderResponseValue(f, val);
                  const isUrl = typeof renderedVal === 'string' &&
                    (renderedVal.startsWith('http://') || renderedVal.startsWith('https://'));
                  const cellKey = `${sub.id}:${f.id}`;
                  const isEditing = editingCell?.subId === sub.id && editingCell?.fieldId === f.id;
                  const isEdited = editedCells.has(cellKey);
                  const isCopied = copiedCell === cellKey;

                  return (
                    <td key={f.id} className="group/cell px-4 py-3 max-w-[350px]">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                            if (e.key === 'Escape') setEditingCell(null);
                          }}
                          className="w-full rounded-sm border border-accent bg-bg-base px-2 py-0.5 text-sm focus:outline-hidden"
                        />
                      ) : (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="flex-1 truncate" title={renderedVal}>
                            {isEdited && (
                              <span className="mr-1 text-[10px] text-text-tertiary" title="Modifié manuellement">
                                ✎
                              </span>
                            )}
                            {isUrl ? (
                              <a
                                href={renderedVal}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                              >
                                Ouvrir le fichier ↗
                              </a>
                            ) : (
                              renderedVal
                            )}
                          </span>
                          {renderedVal !== '—' && (
                            <div className="invisible flex shrink-0 items-center gap-0.5 group-hover/cell:visible">
                              <button
                                onClick={() => handleCopyCell(renderedVal, cellKey)}
                                className="rounded-sm p-0.5 text-text-tertiary transition-colors hover:bg-bg-elevated hover:text-text-primary"
                                title="Copier"
                              >
                                {isCopied ? (
                                  <Check className="h-3 w-3 text-green-500" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                              {!isUrl && (
                                <button
                                  onClick={() => startEdit(sub.id, f.id, renderedVal)}
                                  className="rounded-sm p-0.5 text-text-tertiary transition-colors hover:bg-bg-elevated hover:text-text-primary"
                                  title="Modifier"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

