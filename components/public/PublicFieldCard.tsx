'use client';

import type { Field, Form } from '@/types';
import { FieldRenderer } from '@/components/builder/FieldRenderer';
import type { RendererPricing } from '@/components/builder/fields/OptionPricing';
import {
  fieldControlId,
  fieldDescriptionId,
  fieldLabelId,
  labelsSingleControl
} from '@/lib/field-labelling';
import { getFieldIcon, isIconVisible } from '@/lib/field-icons';
import { isVisibleToRespondent } from '@/lib/public-fields';
import { quantityKey, readQuantityMap, resolvePricing } from '@/lib/pricing';
import { cn } from '@/lib/utils';
import { createContext, useMemo } from 'react';

export const FieldContext = createContext<Field | null>(null);

interface Props {
  field: Field;
  form: Form;
  span: string;
  responses: Record<string, any>;
  updateResponse: (fieldId: string, response: any) => void;
  /**
   * Force la mise en page téléphone, pour le cadre étroit de l'aperçu.
   *
   * La vraie page publique ne le passe pas : elle s'appuie sur les points de
   * rupture CSS, qui regardent la fenêtre.
   */
  mobile?: boolean;
}

export function PublicFieldCard({
  field,
  form,
  span,
  responses,
  updateResponse,
  mobile = false
}: Props) {
  const isRespondentUpload =
    ['file', 'image', 'video'].includes(field.type) &&
    field.validation?.respondent_mode_enabled === true;

  /**
   * Devise et compteurs transmis au rendu.
   *
   * Les quantités vivent dans une clé voisine des réponses — `<champ>__qty` — et
   * non dans la valeur du champ : la réponse garde ainsi sa forme habituelle, et
   * la logique conditionnelle comme les exports continuent d'ignorer qu'il
   * existe des compteurs.
   */
  const pricing: RendererPricing = useMemo(() => {
    const resolved = resolvePricing(form);
    return {
      enabled: resolved.enabled,
      currency: resolved.currency,
      position: resolved.currency_position,
      quantities: readQuantityMap(responses, field.id),
      onQuantitiesChange: (next) => updateResponse(quantityKey(field.id), next)
    };
  }, [form, responses, field.id, updateResponse]);

  /**
   * Rien à demander, rien à montrer.
   *
   * Un champ caché, un total que l'auteur a choisi de garder pour lui, un bloc
   * répétable sans sous-question, un champ calculé sans source : aucun n'attend
   * de réponse. Les deux derniers affichaient jusqu'ici le message destiné à
   * l'AUTEUR — « ajoutez-en dans le panneau de droite » — sur un formulaire
   * publié, devant quelqu'un qui n'a pas de panneau de droite.
   */
  if (!isVisibleToRespondent(field)) return null;

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
            mobile={mobile}
          />
        </div>
      </div>
    );
  }

  // Champs de mise en page : ni titre, ni carte, ni astérisque — ils ne posent
  // aucune question. Les enfermer dans une carte de question ferait passer un
  // filet de séparation pour quelque chose à remplir.
  if (field.type === 'divider') {
    return (
      <div className={cn('py-2', span)}>
        <FieldRenderer field={field} />
      </div>
    );
  }

  if (field.type === 'link') {
    return (
      <div className={cn(span)}>
        <FieldRenderer field={field} />
        {field.description?.fr && (
          <p className="mt-1.5 text-sm text-text-secondary">{field.description.fr}</p>
        )}
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
            labelled
            preview={false}
            mobile={mobile}
            value={responses[field.id]}
            onValueChange={(val) => updateResponse(field.id, val)}
            responses={responses}
            pricing={pricing}
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

  /**
   * Un `<label>` seulement quand il y a un contrôle à désigner.
   *
   * Pour une question à choix, la balise `<label>` n'a rien à pointer : le
   * `for` désignerait la première option, et un lecteur d'écran annoncerait
   * l'intitulé de la question comme le nom de ce bouton-là. Le titre devient
   * alors un bloc nommé, et `FieldRenderer` enveloppe les contrôles dans un
   * groupe qui s'y réfère.
   */
  const single = labelsSingleControl(field.type);
  const Title = single ? 'label' : 'div';

  return (
    <div className="space-y-1">
      {/* Titre du champ */}
      <Title
        id={fieldLabelId(field.id)}
        htmlFor={single ? fieldControlId(field.id) : undefined}
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
            {field.required && (
              <span className="text-red-500 ml-1" aria-hidden="true">
                *
              </span>
            )}
            {/* « obligatoire » se dit, l'astérisque ne s'entend pas. */}
            {field.required && <span className="sr-only"> (obligatoire)</span>}
          </span>
        </span>
      </Title>

      {/* Description du champ */}
      {field.description.fr && (
        <p id={fieldDescriptionId(field.id)} className={cn(
          'text-sm text-text-secondary leading-relaxed',
          isRespondentUpload ? 'italic text-text-tertiary font-normal' : ''
        )}>
          {field.description.fr}
        </p>
      )}
    </div>
  );
}