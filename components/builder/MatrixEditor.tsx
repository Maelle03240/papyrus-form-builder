'use client';

import { ChevronDown, ChevronUp, GripVertical, Plus, X } from 'lucide-react';
import type { Field, FieldOption } from '@/types';
import { newOptionId } from '@/lib/store';
import { cn } from '@/lib/utils';
import { LIMITS } from '@/lib/constants/limits';
import { toast } from '@/components/ui/Toast';

interface Props {
  field: Field;
  onChange: (patch: Partial<Field>) => void;
  scoringEnabled?: boolean;
}

/** Réglages de la matrice : mode, lignes, colonnes. L'édition est aussi possible
 *  directement dans le tableau du canvas — les deux éditeurs sont synchronisés. */
export function MatrixEditor({ field, onChange, scoringEnabled = false }: Props) {
  const rows = field.rows ?? [];
  const cols = field.options ?? [];
  const mode = field.validation?.matrix_mode ?? 'single';

  function updateRows(next: FieldOption[]) {
    onChange({ rows: next });
  }
  function updateCols(next: FieldOption[]) {
    onChange({ options: next });
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-tertiary">
          Mode de réponse
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              { value: 'single', label: 'Une réponse', hint: 'par ligne (radio)' },
              { value: 'multiple', label: 'Plusieurs', hint: 'par ligne (checkbox)' }
            ] as const
          ).map((m) => {
            const active = mode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() =>
                  onChange({ validation: { ...field.validation, matrix_mode: m.value } })
                }
                className={cn(
                  'rounded-md border px-3 py-2 text-left transition',
                  active
                    ? 'border-accent bg-accent/5 text-text-primary'
                    : 'border-border-strong text-text-secondary hover:border-accent'
                )}
              >
                <div className="text-xs font-medium">{m.label}</div>
                <div className="text-[10px] text-text-tertiary">{m.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      <SubEditor title="Lignes (questions)" items={rows} onChange={updateRows} placeholder="Critère" maxItems={LIMITS.MATRIX_ROWS_MAX} />
      <SubEditor title="Colonnes (réponses)" items={cols} onChange={updateCols} placeholder="Réponse" scoringEnabled={scoringEnabled} maxItems={LIMITS.MATRIX_COLS_MAX} />
    </div>
  );
}

function SubEditor({
  title,
  items,
  onChange,
  placeholder,
  scoringEnabled = false,
  maxItems
}: {
  title: string;
  items: FieldOption[];
  onChange: (next: FieldOption[]) => void;
  placeholder: string;
  scoringEnabled?: boolean;
  maxItems: number;
}) {
  function update(id: string, label: string) {
    onChange(items.map((o) => (o.id === id ? { ...o, label: { ...o.label, fr: label } } : o)));
  }

  function updatePoints(id: string, points: number) {
    onChange(items.map((o) => (o.id === id ? { ...o, points } : o)));
  }

  function remove(id: string) {
    if (items.length <= 1) return;
    onChange(items.filter((o) => o.id !== id));
  }

  function add() {
    if (items.length >= maxItems) {
      toast.error(`Limite de ${maxItems} ${title.toLowerCase()} atteinte`);
      return;
    }
    onChange([...items, { id: newOptionId(), label: { fr: '' }, ...(scoringEnabled && { points: 0 }) }]);
  }

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-text-tertiary">{title} ({items.length}/{maxItems})</div>
      <div className="space-y-1">
        {items.map((opt, i) => (
          <div key={opt.id} className="group flex items-center gap-1.5">
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            <input
              value={opt.label.fr || ''}
              onChange={(e) => update(opt.id, e.target.value)}
              placeholder={`${placeholder} ${i + 1}`}
              maxLength={LIMITS.OPTION_LABEL_MAX}
              className="h-8 flex-1 rounded-md border border-border-strong bg-bg-base px-2.5 text-sm text-text-primary focus:border-accent focus:outline-hidden"
            />
            {scoringEnabled && (
              <div className="flex items-center gap-0.5 rounded-md border border-border-strong bg-bg-base px-1.5 py-1">
                <span className="text-xs text-text-secondary min-w-[24px] text-center">
                  {opt.points ?? 0}pts
                </span>
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => updatePoints(opt.id, (opt.points ?? 0) + 1)}
                    className="rounded-sm p-0.5 text-text-tertiary hover:bg-accent/10 hover:text-accent"
                    aria-label="Augmenter les points"
                  >
                    <ChevronUp className="h-2.5 w-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePoints(opt.id, Math.max(0, (opt.points ?? 0) - 1))}
                    className="rounded-sm p-0.5 text-text-tertiary hover:bg-accent/10 hover:text-accent"
                    aria-label="Diminuer les points"
                  >
                    <ChevronDown className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => remove(opt.id)}
              disabled={items.length <= 1}
              className="rounded-sm p-1 text-text-tertiary opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:opacity-0"
              aria-label="Supprimer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 py-1.5 text-xs text-text-secondary transition hover:border-accent hover:text-text-primary"
      >
        <Plus className="h-3.5 w-3.5" />
        Ajouter
      </button>
    </div>
  );
}
