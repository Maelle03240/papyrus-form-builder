'use client';

import { GripVertical, Plus, X } from 'lucide-react';
import type { FieldOption, FieldType } from '@/types';
import { newOptionId } from '@/lib/store';
import { LIMITS } from '@/lib/constants/limits';
import { toast } from '@/components/ui/Toast';

interface Props {
  type: Extract<FieldType, 'single_choice' | 'multiple_choice' | 'dropdown'>;
  options: FieldOption[];
  onChange: (next: FieldOption[]) => void;
  scoringEnabled?: boolean;
}

export function OptionsEditor({ type, options, onChange, scoringEnabled = false }: Props) {
  const maxOptions = type === 'dropdown'
    ? LIMITS.DROPDOWN_OPTIONS_MAX
    : type === 'multiple_choice'
      ? LIMITS.MULTI_CHOICE_OPTIONS_MAX
      : LIMITS.SINGLE_CHOICE_OPTIONS_MAX;

  function update(id: string, label: string) {
    onChange(options.map((o) => (o.id === id ? { ...o, label: { ...o.label, fr: label } } : o)));
  }

  function remove(id: string) {
    onChange(options.filter((o) => o.id !== id));
  }

  function add() {
    if (options.length >= maxOptions) {
      toast.error(`Limite de ${maxOptions} options atteinte`);
      return;
    }
    onChange([
      ...options,
      { id: newOptionId(), label: { fr: `Option ${options.length + 1}` }, ...(scoringEnabled && { points: 0 }) }
    ]);
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Options ({options.length}/{maxOptions})</div>
      <div className="space-y-1.5">
        {options.map((opt) => (
          <div key={opt.id} className="group flex items-center gap-1.5">
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            <input
              value={opt.label.fr || ''}
              onChange={(e) => update(opt.id, e.target.value)}
              placeholder="Texte de l'option"
              maxLength={LIMITS.OPTION_LABEL_MAX}
              className="h-8 flex-1 rounded-md border border-border-strong bg-bg-base px-2.5 text-sm text-text-primary focus:border-accent focus:outline-hidden"
            />
            <button
              type="button"
              onClick={() => remove(opt.id)}
              className="rounded-sm p-1 text-text-tertiary opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
              aria-label="Supprimer l'option"
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
        Ajouter une option
      </button>
    </div>
  );
}
