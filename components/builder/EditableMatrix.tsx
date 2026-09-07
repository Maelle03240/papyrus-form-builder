'use client';

import { Plus, X } from 'lucide-react';
import type { Field } from '@/types';
import { newOptionId } from '@/lib/store';
import { cn } from '@/lib/utils';
import { LIMITS } from '@/lib/constants/limits';
import { toast } from '@/components/ui/Toast';

interface Props {
  field: Field;
  onChange: (patch: Partial<Field>) => void;
}

/**
 * Matrice avec édition inline. Utilise `table-fixed` + <colgroup> pour
 * forcer la table à tenir exactement dans la largeur du parent — pas de scroll.
 */
export function EditableMatrix({ field, onChange }: Props) {
  const rows = field.rows ?? [];
  const cols = field.options ?? [];
  const mode = field.validation?.matrix_mode ?? 'single';
  const inputType = mode === 'multiple' ? 'checkbox' : 'radio';

  function updateRow(id: string, label: string) {
    onChange({
      rows: rows.map((r) => (r.id === id ? { ...r, label: { ...r.label, fr: label } } : r))
    });
  }
  function updateCol(id: string, label: string) {
    onChange({
      options: cols.map((c) => (c.id === id ? { ...c, label: { ...c.label, fr: label } } : c))
    });
  }
  function addRow() {
    if (rows.length >= LIMITS.MATRIX_ROWS_MAX) {
      toast.error(`Limite de ${LIMITS.MATRIX_ROWS_MAX} lignes atteinte`);
      return;
    }
    onChange({ rows: [...rows, { id: newOptionId(), label: { fr: '' } }] });
  }
  function addCol() {
    if (cols.length >= LIMITS.MATRIX_COLS_MAX) {
      toast.error(`Limite de ${LIMITS.MATRIX_COLS_MAX} colonnes atteinte`);
      return;
    }
    onChange({ options: [...cols, { id: newOptionId(), label: { fr: '' } }] });
  }
  function removeRow(id: string) {
    if (rows.length <= 1) return;
    onChange({ rows: rows.filter((r) => r.id !== id) });
  }
  function removeCol(id: string) {
    if (cols.length <= 1) return;
    onChange({ options: cols.filter((c) => c.id !== id) });
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-base">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          {/* Coin / colonne des libellés de lignes */}
          <col style={{ width: '110px' }} />
          {/* Une colonne par option (largeur partagée par table-fixed) */}
          {cols.map((c) => (
            <col key={c.id} />
          ))}
          {/* Cellule du bouton "+" */}
          <col style={{ width: '36px' }} />
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-bg-elevated/40">
            <th className="px-2 py-1.5" />
            {cols.map((col, i) => (
              <th key={col.id} className="group relative px-0.5 py-1">
                <input
                  value={col.label.fr ?? ''}
                  onChange={(e) => updateCol(col.id, e.target.value)}
                  placeholder={`Col. ${i + 1}`}
                  maxLength={LIMITS.OPTION_LABEL_MAX}
                  className="h-7 w-full rounded-sm bg-transparent pl-1 pr-4 text-center text-[11px] font-medium uppercase tracking-wide text-text-secondary placeholder:normal-case placeholder:tracking-normal placeholder:text-text-tertiary focus:bg-bg-elevated/60 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => removeCol(col.id)}
                  disabled={cols.length <= 1}
                  className="absolute right-0 top-1/2 -translate-y-1/2 rounded-sm bg-bg-base/90 p-0.5 text-text-tertiary opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:opacity-0"
                  aria-label="Supprimer la colonne"
                >
                  <X className="h-3 w-3" />
                </button>
              </th>
            ))}
            <th className="px-1 py-1">
              <button
                type="button"
                onClick={addCol}
                className="rounded-sm p-1 text-text-tertiary transition hover:bg-bg-elevated hover:text-text-primary"
                aria-label="Ajouter une colonne"
                title="Ajouter une colonne"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id} className="group border-b border-dashed border-border last:border-b-0">
              <td className="relative px-1 py-1">
                <input
                  value={row.label.fr ?? ''}
                  onChange={(e) => updateRow(row.id, e.target.value)}
                  placeholder={`Ligne ${i + 1}`}
                  maxLength={LIMITS.OPTION_LABEL_MAX}
                  className="h-7 w-full rounded-sm bg-transparent pl-1 pr-5 text-sm text-text-primary placeholder:text-text-tertiary focus:bg-bg-elevated/60 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={rows.length <= 1}
                  className="absolute right-0 top-1/2 -translate-y-1/2 rounded-sm bg-bg-base/90 p-0.5 text-text-tertiary opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:opacity-0"
                  aria-label="Supprimer la ligne"
                >
                  <X className="h-3 w-3" />
                </button>
              </td>
              {cols.map((col) => (
                <td key={col.id} className="px-1 py-1 text-center">
                  <input
                    type={inputType}
                    name={mode === 'single' ? `${field.id}-${row.id}` : undefined}
                    disabled
                    className={cn('h-4 w-4', inputType === 'checkbox' ? 'rounded-sm' : '')}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                </td>
              ))}
              <td />
            </tr>
          ))}
          <tr>
            <td colSpan={cols.length + 2} className="px-1 py-1">
              <button
                type="button"
                onClick={addRow}
                className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-text-tertiary transition hover:bg-bg-elevated hover:text-text-primary"
              >
                <Plus className="h-3 w-3" /> Ajouter une ligne
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
