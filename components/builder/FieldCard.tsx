'use client';

import React, { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Columns2, Copy, Filter, GripVertical, Square, Trash2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Field, FieldStyle, FormTheme, MultilingualText } from '@/types';
import { cn } from '@/lib/utils';
import { FIELD_META } from '@/lib/field-meta';
import { canBeRequired } from '@/lib/submission-format';
import { AutoTextarea } from '@/components/ui/AutoTextarea';
import { Switch } from '@/components/ui/Switch';
import { FieldRenderer } from './FieldRenderer';
import { EditableOptions } from './EditableOptions';
import { EditableMatrix } from './EditableMatrix';
import { LIMITS } from '@/lib/constants/limits';
import { getFieldIcon, isIconVisible } from '@/lib/field-icons';

interface Props {
  field: Field;
  index: number;
  selected: boolean;
  /** Style global appliqué à toutes les questions (depuis form.theme.field_style). */
  globalStyle?: FieldStyle;
  /** Couleur de fond du bloc (depuis form.theme.field_bg_color). */
  cardBg?: string;
  theme: FormTheme;
  scoringEnabled?: boolean;
  /** La tarification est active : les options portent un prix. */
  pricingEnabled?: boolean;
  currency?: string;
  onSelect: () => void;
  onChange: (patch: Partial<Field>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export const SortableFieldCard = memo(function SortableFieldCard(props: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.field.id
  });

  const width = props.field.layout_width ?? 'full';

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    // Sur le grid 2-cols : full = span 2 (pleine largeur), half = span 1 (deux par ligne)
    gridColumn: width === 'half' ? 'span 1 / span 1' : 'span 2 / span 2'
  };

  return (
    <div ref={setNodeRef} style={style} className={cn('min-w-0', isDragging && 'opacity-60')}>
      <FieldCard
        {...props}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </div>
  );
});

interface CardProps extends Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dragHandleProps?: any;
  isDragging?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<FieldStyle['label_size']>, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-2xl'
};

const FONT_CLASSES: Record<NonNullable<FieldStyle['font_family']>, string> = {
  sans: 'font-sans',
  display: 'font-sans', // alias : 'display' était Georgia, désormais aligné sur Aktiv (Mooove)
  serif: 'font-serif',
  mono: 'font-mono'
};

const WEIGHT_CLASSES: Record<NonNullable<FieldStyle['label_weight']>, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  bold: 'font-bold'
};

export const FieldCard = memo(function FieldCard({
  field,
  index,
  selected,
  globalStyle,
  cardBg,
  theme,
  scoringEnabled,
  pricingEnabled,
  currency,
  onSelect,
  onChange,
  onDuplicate,
  onDelete,
  dragHandleProps,
  isDragging
}: CardProps) {
  const meta = FIELD_META[field.type];
  if (!meta) return null;
  const Icon = meta.icon;
  const isImage = field.type === 'image';
  const isVideo = field.type === 'video';
  const isFile = field.type === 'file';
  const isStatement = field.type === 'statement';
  // Un séparateur n'a ni titre ni description : ce n'est qu'un filet. Lui offrir
  // un champ de saisie ferait croire qu'il porte quelque chose.
  const isDivider = field.type === 'divider';
  const conditionCount = field.visibility?.conditions?.length ?? 0;

  const isRespondentUpload =
    ['file', 'image', 'video'].includes(field.type) &&
    field.validation?.respondent_mode_enabled === true;

  // Image, video et file avec titre activé sont traités comme des questions avec numéro
  const showTitleForMedia = (isImage || isVideo || isFile) && field.validation?.show_title;
  const isLayout =
    isDivider ||
    (!isRespondentUpload &&
      ((isImage && !showTitleForMedia) ||
        (isVideo && !showTitleForMedia) ||
        (isFile && !showTitleForMedia)));
  // « Obligatoire » n'a aucun sens sur un séparateur, un lien, un champ caché ou
  // un total calculé : `canBeRequired` est la même règle que celle qu'applique
  // `/api/submit/[slug]`, pour que la case affichée ici corresponde à ce qui est
  // réellement exigé là-bas.
  const collectsAnswer = !isLayout && canBeRequired(field);
  const isChoiceLike =
    field.type === 'single_choice' || field.type === 'multiple_choice' || field.type === 'dropdown';

  function patchText(key: 'label' | 'description', value: string) {
    const current = field[key] ?? ({} as MultilingualText);
    onChange({ [key]: { ...current, fr: value } } as Partial<Field>);
  }

  // Résolution du style : par-champ override le global
  const resolvedStyle: FieldStyle = { ...(globalStyle ?? {}), ...(field.style ?? {}) };
  const labelSize = SIZE_CLASSES[resolvedStyle.label_size ?? 'lg'];
  const labelFont = FONT_CLASSES[resolvedStyle.font_family ?? 'sans'];
  const labelWeight = resolvedStyle.label_weight ? WEIGHT_CLASSES[resolvedStyle.label_weight] : '';
  const labelClass = cn(labelSize, labelFont, labelWeight, resolvedStyle.label_italic && 'italic');
  const labelInlineStyle: CSSProperties = {
    color: resolvedStyle.label_color,
    textAlign: resolvedStyle.label_align
  };

  return (
    <div
      data-field-id={field.id}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      style={{ backgroundColor: cardBg }}
      className={cn(
        'group relative cursor-pointer rounded-lg border px-5 pb-4 pt-3 transition',
        cardBg ? '' : 'bg-bg-surface',
        selected ? 'border-accent shadow-xs' : 'border-border hover:border-border-strong',
        isDragging && 'shadow-xl'
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...dragHandleProps}
        onClick={(e) => e.stopPropagation()}
        className="absolute -left-7 top-1/2 -translate-y-1/2 cursor-grab rounded-sm p-1 text-text-tertiary opacity-0 transition hover:bg-bg-elevated hover:text-text-primary group-hover:opacity-100 active:cursor-grabbing"
        aria-label="Glisser pour réordonner"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* TOOLBAR EN HAUT — type à gauche, actions à droite */}
      <div
        className="mb-2 flex items-center justify-between gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-xs uppercase tracking-wide text-text-tertiary">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{meta.label}</span>
          {/* Une question conditionnelle doit se repérer sans ouvrir son
              panneau : sans ce repère, retrouver laquelle des trente est
              masquée impose de toutes les ouvrir. */}
          {conditionCount > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border bg-bg-elevated px-1.5 py-0.5 normal-case tracking-normal text-text-secondary"
              title={`Affichée sous ${conditionCount} condition${conditionCount > 1 ? 's' : ''}`}
            >
              <Filter className="h-3 w-3" aria-hidden="true" />
              {conditionCount}
            </span>
          )}
        </div>

        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5 transition',
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <ToolbarButton
            onClick={() =>
              onChange({
                layout_width: (field.layout_width ?? 'full') === 'half' ? 'full' : 'half'
              })
            }
            label={
              (field.layout_width ?? 'full') === 'half'
                ? 'Passer en pleine largeur'
                : 'Passer en demi-largeur (2 par ligne)'
            }
            active={(field.layout_width ?? 'full') === 'half'}
          >
            {(field.layout_width ?? 'full') === 'half' ? (
              <Columns2 className="h-3.5 w-3.5" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
          </ToolbarButton>
          <ToolbarButton onClick={onDuplicate} label="Dupliquer">
            <Copy className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={onDelete} label="Supprimer" danger>
            <Trash2 className="h-3.5 w-3.5" />
          </ToolbarButton>

          {collectsAnswer && (
            <>
              <span className="mx-1 h-4 w-px bg-border" />
              <span className="text-[11px] text-text-secondary">Obligatoire</span>
              <Switch
                checked={field.required}
                onChange={(required) => onChange({ required })}
              />
            </>
          )}
        </div>
      </div>

      {/* Question — éditable inline (titre optionnel pour les statements) */}
      {!isLayout || showTitleForMedia ? (
        <div className="mb-1.5 flex items-center gap-2">
          {isIconVisible(field, theme) && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'var(--bg-overlay)',
                border: '0.5px solid var(--border)',
                marginRight: 6,
                flexShrink: 0,
              }}
            >
              {field.style?.icon_value?.startsWith('ti-') ? (
                <i
                  className={`ti ${field.style.icon_value}`}
                  aria-hidden="true"
                  style={{ fontSize: 20, color: 'var(--accent)' }}
                />
              ) : field.style?.icon_value ? (
                <span style={{ fontSize: 22, lineHeight: 1 }}>
                  {field.style.icon_value}
                </span>
              ) : (
                <i
                  className={`ti ${getFieldIcon(field)}`}
                  aria-hidden="true"
                  style={{ fontSize: 20, color: 'var(--accent)' }}
                />
              )}
            </span>
          )}
          {(!isStatement || showTitleForMedia) && (
            <span className="papyrus-numeral shrink-0 text-sm">{romanNumeral(index + 1)}.</span>
          )}
          <AutoTextarea
            value={field.label.fr ?? ''}
            onChange={(e) => patchText('label', e.target.value)}
            placeholder={
              isStatement
                ? 'Titre (optionnel)'
                : showTitleForMedia
                  ? 'Titre du média'
                  : 'Tapez votre question…'
            }
            style={labelInlineStyle}
            maxLength={LIMITS.FIELD_LABEL_MAX}
            className={cn(
              '-mx-1 min-w-0 flex-1 rounded-sm bg-transparent px-1 leading-snug text-text-primary placeholder:text-text-tertiary focus:bg-bg-elevated/50 focus:outline-hidden',
              labelClass
            )}
          />
          {field.required && <span className="shrink-0 text-danger">*</span>}
        </div>
      ) : (
        !isImage && !isVideo && !isFile && (
          <div className="mb-1.5 flex items-center gap-2">
            {isIconVisible(field, theme) && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: 'var(--bg-overlay)',
                  border: '0.5px solid var(--border)',
                  marginRight: 6,
                  flexShrink: 0,
                }}
              >
                {field.style?.icon_value?.startsWith('ti-') ? (
                  <i
                    className={`ti ${field.style.icon_value}`}
                    aria-hidden="true"
                    style={{ fontSize: 20, color: 'var(--accent)' }}
                  />
                ) : field.style?.icon_value ? (
                  <span style={{ fontSize: 22, lineHeight: 1 }}>
                    {field.style.icon_value}
                  </span>
                ) : (
                  <i
                    className={`ti ${getFieldIcon(field)}`}
                    aria-hidden="true"
                    style={{ fontSize: 20, color: 'var(--accent)' }}
                  />
                )}
              </span>
            )}
            <AutoTextarea
              value={field.label.fr ?? ''}
              onChange={(e) => patchText('label', e.target.value)}
              placeholder="Légende (optionnelle)"
              style={labelInlineStyle}
              maxLength={LIMITS.SECTION_TITLE_MAX}
              className={cn(
                '-mx-1 mb-1.5 w-full rounded-sm bg-transparent px-1 leading-snug text-text-primary placeholder:text-text-tertiary focus:bg-bg-elevated/50 focus:outline-hidden',
                labelClass
              )}
            />
          </div>
        )
      )}

      {/* Description — éditable inline (ni pour les médias, ni pour un séparateur) */}
      {!isImage && !isVideo && !isFile && !isDivider && (
        <AutoTextarea
          value={field.description.fr ?? ''}
          onChange={(e) => patchText('description', e.target.value)}
          placeholder={isStatement ? 'Tapez votre texte…' : 'Description (optionnelle)'}
          maxLength={field.type === 'statement' ? LIMITS.STATEMENT_TEXT_MAX : LIMITS.FIELD_DESCRIPTION_MAX}
          className="-mx-1 mb-2.5 w-full rounded-sm bg-transparent px-1 text-sm italic text-text-secondary placeholder:text-text-tertiary placeholder:not-italic focus:bg-bg-elevated/50 focus:outline-hidden"
        />
      )}

      {/* Aperçu — édition inline pour les choix et la matrice, sinon FieldRenderer en preview */}
      {isStatement ? null : isChoiceLike ? (
        <EditableOptions
          type={field.type as 'single_choice' | 'multiple_choice' | 'dropdown'}
          field={field}
          onChange={onChange}
          scoringEnabled={scoringEnabled}
          pricingEnabled={pricingEnabled}
          currency={currency}
        />
      ) : field.type === 'matrix' ? (
        <EditableMatrix field={field} onChange={onChange} />
      ) : (
        <FieldRenderer field={field} preview={false} onChange={onChange} globalStyle={globalStyle} />
      )}
    </div>
  );
}, (prevProps: Props, nextProps: Props) => {
  // Optimisation : ne re-render que si les props importantes changent
  return (
    prevProps.field === nextProps.field &&
    prevProps.selected === nextProps.selected &&
    prevProps.globalStyle === nextProps.globalStyle &&
    prevProps.cardBg === nextProps.cardBg &&
    prevProps.scoringEnabled === nextProps.scoringEnabled &&
    prevProps.pricingEnabled === nextProps.pricingEnabled &&
    prevProps.currency === nextProps.currency &&
    prevProps.theme.fields_icons_enabled === nextProps.theme.fields_icons_enabled &&
    prevProps.index === nextProps.index
  );
});

function ToolbarButton({
  children,
  onClick,
  label,
  danger,
  active
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={cn(
        'rounded-sm p-1.5 transition',
        active
          ? 'bg-accent/10 text-accent'
          : danger
            ? 'text-text-tertiary hover:bg-danger/10 hover:text-danger'
            : 'text-text-tertiary hover:bg-bg-elevated hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}

function romanNumeral(n: number): string {
  const lookup: [number, string][] = [
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i']
  ];
  let result = '';
  let remaining = n;
  for (const [val, sym] of lookup) {
    while (remaining >= val) {
      result += sym;
      remaining -= val;
    }
  }
  return result;
}
