'use client';

import { ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { FieldType, MultilingualText, SubField } from '@/types';
import { newOptionId } from '@/lib/store';
import { FIELD_CATEGORIES, FIELD_META } from '@/lib/field-meta';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/Switch';

interface Props {
  subfields: SubField[];
  onChange: (next: SubField[]) => void;
}

const ALLOWED_SUBFIELD_TYPES: FieldType[] = [
  'short_text',
  'long_text',
  'email',
  'url',
  'phone',
  'number',
  'date',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'rating',
  'nps',
  'file'
];

/**
 * Éditeur de sous-questions d'un multiple_choice. Un seul jeu de sous-champs
 * qui sera appliqué à chaque option cochée par le répondant.
 */
export function SubfieldsEditor({ subfields, onChange }: Props) {
  const [picker, setPicker] = useState(false);

  function add(type: FieldType) {
    const sf: SubField = {
      id: newOptionId(),
      type,
      label: emptyML(`Question (${FIELD_META[type].label})`),
      description: emptyML(),
      placeholder: emptyML(),
      options:
        type === 'single_choice' || type === 'multiple_choice' || type === 'dropdown'
          ? [
              { id: newOptionId(), label: emptyML('Option 1') },
              { id: newOptionId(), label: emptyML('Option 2') }
            ]
          : [],
      required: false,
      validation: {}
    };
    onChange([...subfields, sf]);
    setPicker(false);
  }

  function update(id: string, patch: Partial<SubField>) {
    onChange(subfields.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function remove(id: string) {
    onChange(subfields.filter((s) => s.id !== id));
  }

  function move(id: string, dir: -1 | 1) {
    const i = subfields.findIndex((s) => s.id === id);
    if (i === -1) return;
    const j = i + dir;
    if (j < 0 || j >= subfields.length) return;
    const next = [...subfields];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] italic text-text-tertiary">
        i. Ces sous-questions s&apos;afficheront sous <em>chaque</em> option cochée par le
        répondant. En BDD, chaque combinaison option × sous-question aura sa propre colonne.
      </p>

      {subfields.length === 0 && (
        <div className="rounded-md border border-dashed border-border-strong bg-bg-base px-3 py-4 text-center text-xs text-text-tertiary">
          Aucune sous-question. Ajoutes-en une ci-dessous.
        </div>
      )}

      <div className="space-y-2">
        {subfields.map((sf, idx) => (
          <SubfieldRow
            key={sf.id}
            subfield={sf}
            isFirst={idx === 0}
            isLast={idx === subfields.length - 1}
            onUpdate={(patch) => update(sf.id, patch)}
            onRemove={() => remove(sf.id)}
            onMoveUp={() => move(sf.id, -1)}
            onMoveDown={() => move(sf.id, 1)}
          />
        ))}
      </div>

      {!picker ? (
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 py-2 text-xs text-text-secondary transition hover:border-accent hover:text-text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter une sous-question
        </button>
      ) : (
        <div className="space-y-3 rounded-md border border-border bg-bg-base p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
              Choisis un type
            </span>
            <button
              type="button"
              onClick={() => setPicker(false)}
              className="text-xs text-text-tertiary hover:text-text-primary"
            >
              Annuler
            </button>
          </div>
          {FIELD_CATEGORIES.map((cat) => {
            const types = cat.types.filter((t) => ALLOWED_SUBFIELD_TYPES.includes(t));
            if (types.length === 0) return null;
            return (
              <div key={cat.title} className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-text-tertiary">
                  {cat.title}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {types.map((t) => {
                    const meta = FIELD_META[t];
                    const Icon = meta.icon;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => add(t)}
                        className="flex items-center gap-2 rounded-md border border-border-strong px-2 py-1.5 text-left text-xs text-text-primary transition hover:border-accent hover:bg-accent/5"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
                        <span className="truncate">{meta.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Une ligne / sous-question (formulaire compact, dépliable)
// ============================================================================

function SubfieldRow({
  subfield,
  isFirst,
  isLast,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown
}: {
  subfield: SubField;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (patch: Partial<SubField>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [open, setOpen] = useState(true);
  const meta = FIELD_META[subfield.type];
  const Icon = meta.icon;
  const isChoice =
    subfield.type === 'single_choice' ||
    subfield.type === 'multiple_choice' ||
    subfield.type === 'dropdown';
  const hasPlaceholder = meta.hasPlaceholder;

  function patchLabel(value: string) {
    onUpdate({ label: { ...subfield.label, fr: value } });
  }
  function patchPlaceholder(value: string) {
    onUpdate({ placeholder: { ...subfield.placeholder, fr: value } });
  }

  function patchOptions(updater: (opts: typeof subfield.options) => typeof subfield.options) {
    onUpdate({ options: updater(subfield.options) });
  }

  function addOption() {
    patchOptions((opts) => [
      ...opts,
      { id: newOptionId(), label: { fr: `Option ${opts.length + 1}` } }
    ]);
  }
  function updateOption(id: string, label: string) {
    patchOptions((opts) =>
      opts.map((o) => (o.id === id ? { ...o, label: { ...o.label, fr: label } } : o))
    );
  }
  function removeOption(id: string) {
    patchOptions((opts) => opts.filter((o) => o.id !== id));
  }

  return (
    <div className="rounded-md border border-border bg-bg-surface">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <div className="flex flex-col">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label="Monter"
            className="text-text-tertiary transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <GripVertical className="h-3 w-3 rotate-90" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label="Descendre"
            className="text-text-tertiary transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <GripVertical className="h-3 w-3 -rotate-90" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
          <span className="truncate text-sm text-text-primary">
            {subfield.label.fr || 'Sous-question sans titre'}
          </span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-text-tertiary transition',
              open ? '' : '-rotate-90'
            )}
          />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-sm p-1 text-text-tertiary transition hover:bg-danger/10 hover:text-danger"
          aria-label="Supprimer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div className="space-y-2.5 border-t border-dashed border-border px-3 py-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-text-tertiary">
              Libellé
            </label>
            <input
              value={subfield.label.fr ?? ''}
              onChange={(e) => patchLabel(e.target.value)}
              placeholder="Question complémentaire"
              className="mt-1 h-8 w-full rounded-sm border border-border-strong bg-bg-base px-2 text-sm text-text-primary focus:border-accent focus:outline-hidden"
            />
          </div>

          {hasPlaceholder && (
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-text-tertiary">
                Placeholder
              </label>
              <input
                value={subfield.placeholder.fr ?? ''}
                onChange={(e) => patchPlaceholder(e.target.value)}
                placeholder="Texte indicatif (optionnel)"
                className="mt-1 h-8 w-full rounded-sm border border-border-strong bg-bg-base px-2 text-xs text-text-primary focus:border-accent focus:outline-hidden"
              />
            </div>
          )}

          {isChoice && (
            <div className="space-y-1.5">
              <label className="block text-[11px] uppercase tracking-wide text-text-tertiary">
                Options
              </label>
              {subfield.options.map((opt) => (
                <div key={opt.id} className="group flex items-center gap-1.5">
                  <input
                    value={opt.label.fr ?? ''}
                    onChange={(e) => updateOption(opt.id, e.target.value)}
                    className="h-7 flex-1 rounded-sm border border-border-strong bg-bg-base px-2 text-xs text-text-primary focus:border-accent focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => removeOption(opt.id)}
                    disabled={subfield.options.length <= 1}
                    className="rounded-sm p-0.5 text-text-tertiary opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addOption}
                className="flex items-center gap-1 text-[11px] text-text-secondary transition hover:text-accent"
              >
                <Plus className="h-3 w-3" /> Ajouter une option
              </button>
            </div>
          )}

          {subfield.type === 'rating' && (
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-text-tertiary">
                Nombre d&apos;étoiles
              </label>
              <select
                value={subfield.validation.max ?? 5}
                onChange={(e) =>
                  onUpdate({
                    validation: { ...subfield.validation, max: Number(e.target.value) }
                  })
                }
                className="mt-1 h-8 w-full rounded-sm border border-border-strong bg-bg-surface px-2 text-xs focus:border-accent focus:outline-hidden"
              >
                {[3, 5, 7, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Switch
            checked={subfield.required ?? false}
            onChange={(required) => onUpdate({ required })}
            label="Obligatoire"
          />
        </div>
      )}
    </div>
  );
}

function emptyML(fr = ''): MultilingualText {
  return { fr };
}
