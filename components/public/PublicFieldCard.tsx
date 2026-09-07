'use client';

import type { Field, Form } from '@/types';
import { FieldRenderer } from '@/components/builder/FieldRenderer';
import { getFieldIcon, isIconVisible } from '@/lib/field-icons';
import { cn } from '@/lib/utils';
import { createContext } from 'react';

export const FieldContext = createContext<Field | null>(null);

interface Props {
  field: Field;
  form: Form;
  span: string;
  responses: Record<string, any>;
  updateResponse: (fieldId: string, response: any) => void;
}

export function PublicFieldCard({
  field,
  form,
  span,
  responses,
  updateResponse
}: Props) {
  // Section break = séparateur visuel
  if (field.type === 'section_break') {
    return (
      <div className="col-span-2 pt-6">
        {field.label.fr && (
          <h2 className="font-display text-2xl text-text-primary flex items-center gap-2">
            {isIconVisible(field, form.theme) && (
              <span
                className="inline-flex items-center justify-center shrink-0 rounded-lg"
                style={{
                  width: 36,
                  height: 36,
                  background: 'var(--papyrus-surface)',
                  border: '0.5px solid var(--papyrus-border)',
                  marginRight: 6,
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
            <span>{field.label.fr}</span>
          </h2>
        )}
        <div className="papyrus-divider mt-2" />
      </div>
    );
  }

  const isRespondentUpload =
    ['file', 'image', 'video'].includes(field.type) &&
    field.validation?.respondent_mode_enabled === true;

  // En mode Créateur uniquement : on rend le contenu média enveloppé dans une carte avec titre et description
  if (['file', 'image', 'video'].includes(field.type) && !isRespondentUpload) {
    return (
      <div
        className={cn(
          'field-wrapper min-w-0 rounded-lg border border-border p-5',
          span,
          form.theme.field_bg_color ? '' : 'bg-bg-surface'
        )}
        style={{ backgroundColor: form.theme.field_bg_color }}
      >
        {field.label.fr && (
          <h3 className="field-label font-display text-lg text-text-primary mb-1">
            {field.label.fr}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </h3>
        )}
        {field.description?.fr && (
          <p className="field-description text-sm text-text-secondary mb-4 leading-relaxed">
            {field.description.fr}
          </p>
        )}
        <div className="mt-2">
          <FieldRenderer
            field={{
              ...field,
              validation: {
                ...field.validation,
                show_title: false
              }
            }}
            preview={true}
            mobile={false}
          />
        </div>
      </div>
    );
  }

  // Statement = texte libre informatif
  if (field.type === 'statement') {
    return (
      <div
        className={cn('border-l-2 pl-4 py-1', span)}
        style={{ borderColor: form.theme.accent }}
      >
        {field.label.fr && (
          <h3 className="font-display text-lg text-text-primary">{field.label.fr}</h3>
        )}
        {field.description.fr && (
          <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed text-text-primary">
            {field.description.fr}
          </p>
        )}
      </div>
    );
  }

  // Mode Répondant ou Champ de saisie standard
  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border border-border p-5',
        span,
        form.theme.field_bg_color ? '' : 'bg-bg-surface'
      )}
      style={{ backgroundColor: form.theme.field_bg_color }}
    >
      <PublicFieldQuestion field={field} theme={form.theme} />
      <div className="mt-4">
        <FieldContext.Provider value={field}>
          <FieldRenderer
            field={field}
            preview={false}
            mobile={false}
            value={responses[field.id]}
            onValueChange={(val) => updateResponse(field.id, val)}
          />
        </FieldContext.Provider>
      </div>
    </div>
  );
}

/** Affiche le titre/description d'un champ dans la vue publique */
function PublicFieldQuestion({
  field,
  theme
}: {
  field: Field;
  theme: Form['theme'];
}) {
  const style = { ...theme.field_style, ...field.style };
  const isRespondentUpload =
    ['file', 'image', 'video'].includes(field.type) &&
    field.validation?.respondent_mode_enabled === true;

  return (
    <div className="space-y-1">
      {/* Titre du champ */}
      <label
        className={cn(
          'block font-medium',
          style?.label_weight === 'bold' ? 'font-bold' : style?.label_weight === 'normal' ? 'font-normal' : 'font-medium',
          style?.label_size === 'sm' ? 'text-sm' : style?.label_size === 'lg' ? 'text-lg' : style?.label_size === 'xl' ? 'text-xl' : 'text-base',
          style?.label_align === 'center' ? 'text-center' : style?.label_align === 'right' ? 'text-right' : 'text-left',
          style?.label_italic ? 'italic' : ''
        )}
        style={{
          color: style?.label_color || 'var(--fg-primary)',
          fontFamily: style?.font_family === 'serif' ? 'var(--font-display)' : style?.font_family === 'mono' ? 'var(--font-mono)' : 'var(--font-body)'
        }}
      >
        <span className="flex items-center gap-2">
          {isIconVisible(field, theme) && (
            <span className="shrink-0">
              {field.style?.icon_value?.startsWith('ti-') ? (
                <i
                  className={`ti ${field.style.icon_value}`}
                  aria-hidden="true"
                  style={{ fontSize: 18, color: 'var(--accent)' }}
                />
              ) : field.style?.icon_value ? (
                <span style={{ fontSize: 20, lineHeight: 1 }}>
                  {field.style.icon_value}
                </span>
              ) : (
                <i
                  className={`ti ${getFieldIcon(field)}`}
                  aria-hidden="true"
                  style={{ fontSize: 18, color: 'var(--accent)' }}
                />
              )}
            </span>
          )}
          <span>
            {field.label.fr}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </span>
        </span>
      </label>

      {/* Description du champ */}
      {field.description.fr && (
        <p className={cn(
          'text-sm text-text-secondary leading-relaxed',
          isRespondentUpload ? 'italic text-text-tertiary font-normal' : ''
        )}>
          {field.description.fr}
        </p>
      )}
    </div>
  );
}