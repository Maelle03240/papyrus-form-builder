'use client';

import { useRef, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Circle, Plus, Square, X } from 'lucide-react';
import type { Field, FieldOption, FieldValidation, FieldType } from '@/types';
import { newOptionId } from '@/lib/store';
import { cn } from '@/lib/utils';
import { LIMITS } from '@/lib/constants/limits';
import { toast } from '@/components/ui/Toast';

interface Props {
  type: Extract<FieldType, 'single_choice' | 'multiple_choice' | 'dropdown'>;
  field: Field;
  onChange: (patch: Partial<Field>) => void;
  scoringEnabled?: boolean;
}

/** Édition inline des options d'un champ à choix — Enter ajoute, Backspace sur vide supprime. */
export function EditableOptions({ type, field, onChange, scoringEnabled = false }: Props) {
  const options = field.options;
  const hasOther = field.validation?.has_other ?? false;
  const otherLabel = field.validation?.other_label ?? 'Autre';

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const otherRef = useRef<HTMLInputElement | null>(null);

  function focusInput(id: string) {
    requestAnimationFrame(() => inputRefs.current[id]?.focus());
  }

  function updateLabel(id: string, value: string) {
    onChange({
      options: options.map((o) => (o.id === id ? { ...o, label: { ...o.label, fr: value } } : o))
    });
  }

  function updatePoints(id: string, points: number) {
    onChange({
      options: options.map((o) => (o.id === id ? { ...o, points } : o))
    });
  }

  const maxOptions = type === 'dropdown'
    ? LIMITS.DROPDOWN_OPTIONS_MAX
    : type === 'multiple_choice'
      ? LIMITS.MULTI_CHOICE_OPTIONS_MAX
      : LIMITS.SINGLE_CHOICE_OPTIONS_MAX;

  function insertAfter(currentId: string) {
    if (options.length >= maxOptions) {
      toast.error(`Limite de ${maxOptions} options atteinte`);
      return;
    }
    const idx = options.findIndex((o) => o.id === currentId);
    if (idx === -1) return;
    const newId = newOptionId();
    const next = [
      ...options.slice(0, idx + 1),
      { id: newId, label: { fr: '' } } as FieldOption,
      ...options.slice(idx + 1)
    ];
    onChange({ options: next });
    focusInput(newId);
  }

  function removeAt(currentId: string) {
    const idx = options.findIndex((o) => o.id === currentId);
    if (idx === -1) return;
    if (options.length <= 1) return; // on garde au moins une option
    const next = options.filter((o) => o.id !== currentId);
    onChange({ options: next });
    // Focus l'option précédente (ou la suivante si c'était la première)
    const target = options[idx - 1] ?? options[idx + 1];
    if (target) focusInput(target.id);
  }

  function appendOption() {
    if (options.length >= maxOptions) {
      toast.error(`Limite de ${maxOptions} options atteinte`);
      return;
    }
    const newId = newOptionId();
    onChange({ options: [...options, { id: newId, label: { fr: '' } } as FieldOption] });
    focusInput(newId);
  }

  function patchValidation(patch: Partial<FieldValidation>) {
    onChange({ validation: { ...field.validation, ...patch } });
  }

  function toggleOther() {
    const next = !hasOther;
    patchValidation({ has_other: next });
    if (next) {
      // focus le label "Autre" pour permettre de le renommer immédiatement
      requestAnimationFrame(() => otherRef.current?.focus());
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>, opt: FieldOption) {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertAfter(opt.id);
      return;
    }
    if (e.key === 'Backspace' && opt.label.fr === '' && options.length > 1) {
      e.preventDefault();
      removeAt(opt.id);
    }
  }

  const Marker = type === 'multiple_choice' ? Square : type === 'dropdown' ? ChevronDown : Circle;
  const cols = field.validation?.options_columns ?? 1;
  const gridClass =
    cols === 3 ? 'grid grid-cols-3 gap-x-3 gap-y-1.5' : cols === 2 ? 'grid grid-cols-2 gap-x-3 gap-y-1.5' : 'space-y-1.5';

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className={gridClass}>
          {options.map((opt, i) => (
          <div key={opt.id} className="group flex min-w-0 items-center gap-2">
            <Marker className="h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={1.75} />
            <input
              ref={(el) => {
                inputRefs.current[opt.id] = el;
              }}
              value={opt.label.fr ?? ''}
              onChange={(e) => updateLabel(opt.id, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, opt)}
              placeholder={`Option ${i + 1}`}
              maxLength={LIMITS.OPTION_LABEL_MAX}
              className="h-8 min-w-0 flex-1 rounded-sm bg-transparent px-2 text-sm text-text-primary placeholder:text-text-tertiary focus:bg-bg-elevated/60 focus:outline-hidden"
            />
            {scoringEnabled && (
              <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-bg-surface px-1.5 py-0.5 shadow-xs">
                <span className="text-xs font-semibold text-text-primary min-w-[14px] text-center">
                  {(opt.points ?? 0) > 0 ? `+${opt.points}` : `${opt.points ?? 0}`}
                </span>
                <span className="text-[9px] text-text-tertiary select-none">pts</span>
                <div className="flex flex-col ml-0.5">
                  <button
                    type="button"
                    onClick={() => updatePoints(opt.id, (opt.points ?? 0) + 1)}
                    className="rounded-sm p-0.5 text-text-tertiary hover:bg-accent/15 hover:text-accent transition"
                    aria-label="Augmenter les points"
                  >
                    <ChevronUp className="h-2 w-2" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePoints(opt.id, Math.max(0, (opt.points ?? 0) - 1))}
                    className="rounded-sm p-0.5 text-text-tertiary hover:bg-accent/15 hover:text-accent transition"
                    aria-label="Diminuer les points"
                  >
                    <ChevronDown className="h-2 w-2" />
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => removeAt(opt.id)}
              disabled={options.length <= 1}
              className={cn(
                'rounded-sm p-1 text-text-tertiary transition opacity-0 group-hover:opacity-100',
                'hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30'
              )}
              aria-label="Supprimer l'option"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Option "Autre" — toujours en pleine largeur, hors grid */}
      {hasOther && (
        <div className="group flex items-center gap-2">
          <Marker className="h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={1.75} />
          <input
            ref={otherRef}
            value={otherLabel}
            onChange={(e) => patchValidation({ other_label: e.target.value })}
            placeholder="Autre…"
            maxLength={LIMITS.OPTION_LABEL_MAX}
            className="h-8 w-32 shrink-0 rounded-sm bg-transparent px-2 text-sm italic text-text-secondary placeholder:not-italic focus:bg-bg-elevated/60 focus:outline-hidden"
          />
          <span className="papyrus-meta truncate text-xs not-italic text-text-tertiary">
            i. le répondant pourra écrire sa réponse
          </span>
          <button
            type="button"
            onClick={toggleOther}
            className="rounded-sm p-1 text-text-tertiary transition opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
            aria-label="Retirer Autre"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Actions sous la liste */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={appendOption}
          className="flex items-center gap-1 text-xs text-text-secondary transition hover:text-accent"
        >
          <Plus className="h-3 w-3" /> Ajouter une option
        </button>
        {!hasOther && (
          <>
            <span className="text-text-tertiary">·</span>
            <button
              type="button"
              onClick={toggleOther}
              className="flex items-center gap-1 text-xs italic text-text-secondary transition hover:text-accent"
            >
              <Plus className="h-3 w-3" /> Ajouter <span className="not-italic">«&nbsp;Autre&nbsp;»</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
