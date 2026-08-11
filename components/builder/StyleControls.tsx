'use client';

import { AlignCenter, AlignLeft, AlignRight, Bold, Italic } from 'lucide-react';
import type { FieldStyle, FontFamily, LabelSize, LabelWeight, TextAlign } from '@/types';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { DebouncedColorInput } from '@/components/ui/DebouncedColorInput';

interface Props {
  style: FieldStyle;
  onChange: (style: FieldStyle) => void;
  introColor?: string;
  onIntroColorChange?: (color: string | undefined) => void;
}

const SIZES: { value: LabelSize; label: string }[] = [
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
  { value: 'xl', label: 'XL' }
];

const FONTS: { value: FontFamily; label: string; preview: string }[] = [
  { value: 'sans', label: 'Aktiv Grotesk', preview: 'Aa' },
  { value: 'serif', label: 'Georgia', preview: 'Aa' },
  { value: 'mono', label: 'JetBrains Mono', preview: 'Aa' }
];

const PRESET_COLORS = [
  '#052139', // navy
  '#052139', // ink
  '#4A6B82', // muted
  '#3C5EAB', // electric
  '#2AC2DE', // cyan
  '#F6923E', // amber
  '#C0392B', // danger
  '#FFFFFF'
];

/** Contrôles réutilisables pour FieldStyle. Utilisé en per-field ET en per-form (global). */
export function StyleControls({ style, onChange, introColor, onIntroColorChange }: Props) {
  function patch(p: Partial<FieldStyle>) {
    onChange({ ...style, ...p });
  }

  return (
    <div className="space-y-3">
      <Section title="Couleur du titre">
        <div className="grid grid-cols-8 gap-0.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => patch({ label_color: c })}
              className={cn(
                'h-4 w-4 rounded border transition',
                style.label_color === c ? 'ring-1 ring-accent ring-offset-1 ring-offset-bg-surface' : 'border-border'
              )}
              style={{ backgroundColor: c }}
              aria-label={`Couleur ${c}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <DebouncedColorInput
            value={style.label_color ?? '#052139'}
            onChange={(val) => patch({ label_color: val })}
            className="h-9 w-12 cursor-pointer rounded border border-border-strong bg-bg-base"
          />
          <Input
            value={style.label_color ?? ''}
            onChange={(e) => patch({ label_color: e.target.value || undefined })}
            placeholder="par défaut"
            className="flex-1 font-mono text-xs"
          />
        </div>
      </Section>

      {onIntroColorChange && (
        <Section title="Couleur de l'intro">
          <div className="flex items-center gap-2">
            <DebouncedColorInput
              value={introColor ?? '#4A6B82'}
              onChange={(val) => onIntroColorChange(val)}
              className="h-9 w-12 cursor-pointer rounded border border-border-strong bg-bg-base"
              aria-label="Couleur de l'intro"
            />
            <Input
              value={introColor ?? ''}
              onChange={(e) => onIntroColorChange(e.target.value === '' ? undefined : e.target.value)}
              placeholder="Par défaut"
              className="flex-1 font-mono text-xs"
            />
            {introColor && (
              <button
                type="button"
                onClick={() => onIntroColorChange(undefined)}
                className="shrink-0 text-text-tertiary hover:text-danger transition"
                aria-label="Réinitialiser"
              >
                ×
              </button>
            )}
          </div>
        </Section>
      )}

      <Section title="Police">
        <div className="grid grid-cols-3 gap-1">
          {FONTS.map((f) => {
            // Le défaut conceptuel est désormais Aktiv Grotesk (sans). On garde 'display'
            // comme alias historique mappant aussi au sans pour ne pas casser les forms existants.
            const current = style.font_family ?? 'sans';
            const isDefaultSans = (current === 'sans' || current === 'display') && f.value === 'sans';
            const active = current === f.value || isDefaultSans;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => patch({ font_family: f.value })}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded border px-1.5 py-1.5 transition',
                  active ? 'border-accent bg-accent/5' : 'border-border-strong hover:border-accent'
                )}
              >
                <span
                  className={cn(
                    'text-lg leading-none',
                    f.value === 'sans'
                      ? 'font-sans'
                      : f.value === 'serif'
                        ? 'font-serif'
                        : 'font-mono'
                  )}
                >
                  {f.preview}
                </span>
                <span className="text-[9px] text-text-tertiary">{f.label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Taille">
        <div className="grid grid-cols-4 gap-1">
          {SIZES.map((s) => {
            const active = (style.label_size ?? 'lg') === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => patch({ label_size: s.value })}
                className={cn(
                  'rounded border py-1.5 text-xs font-medium transition',
                  active
                    ? 'border-accent bg-accent/5 text-text-primary'
                    : 'border-border-strong text-text-secondary hover:border-accent'
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Alignement & emphase">
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              { value: 'left' as TextAlign, icon: AlignLeft },
              { value: 'center' as TextAlign, icon: AlignCenter },
              { value: 'right' as TextAlign, icon: AlignRight }
            ]
          ).map(({ value, icon: Icon }) => {
            const active = (style.label_align ?? 'left') === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => patch({ label_align: value })}
                className={cn(
                  'flex items-center justify-center rounded border py-1.5 transition',
                  active
                    ? 'border-accent bg-accent/5 text-text-primary'
                    : 'border-border-strong text-text-secondary hover:border-accent'
                )}
                aria-label={value}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() =>
              patch({ label_weight: style.label_weight === 'bold' ? 'normal' : ('bold' as LabelWeight) })
            }
            className={cn(
              'flex items-center justify-center gap-1 rounded border py-1.5 text-xs transition',
              style.label_weight === 'bold'
                ? 'border-accent bg-accent/5 text-text-primary'
                : 'border-border-strong text-text-secondary hover:border-accent'
            )}
          >
            <Bold className="h-3.5 w-3.5" /> Gras
          </button>
          <button
            type="button"
            onClick={() => patch({ label_italic: !style.label_italic })}
            className={cn(
              'flex items-center justify-center gap-1 rounded border py-1.5 text-xs transition',
              style.label_italic
                ? 'border-accent bg-accent/5 text-text-primary'
                : 'border-border-strong text-text-secondary hover:border-accent'
            )}
          >
            <Italic className="h-3.5 w-3.5" /> Italique
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-dashed border-border pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
