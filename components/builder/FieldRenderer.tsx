'use client';

import { useMemo, useState, useRef } from 'react';
import { Star, Upload, Calendar } from 'lucide-react';
import type { Field, FieldOption, SubField } from '@/types';
import { AutoTextarea } from '@/components/ui/AutoTextarea';
import { PhoneField as BuilderPhoneField } from './fields/PhoneField';
import { PhoneField as RespondentPhoneField } from '@/components/respondent/fields/PhoneField';
import { FileUploadField } from '@/components/respondent/fields/FileUploadField';
import { parseVideoEmbed } from '@/lib/video';
import { cn } from '@/lib/utils';
import { LIMITS } from '@/lib/constants/limits';
import { toast } from '@/components/ui/Toast';
import { useAttachmentUpload } from '@/lib/hooks/useAttachmentUpload';
import {
  CalculatedField,
  CountryField,
  CurrencyField,
  HiddenField,
  LinkField,
  RepeaterField,
  SignatureField,
  YesNoField
} from './fields/Phase2Fields';
import { OptionPrice, QuantityRow, type RendererPricing } from './fields/OptionPricing';
import { formatMoney } from '@/lib/pricing';
import {
  controlAttrsFor,
  fieldDescriptionId,
  fieldLabelId,
  isGroupedField,
  type ControlAttrs
} from '@/lib/field-labelling';

/** Retourne les types de fichiers acceptés par défaut selon le type de champ */
function getDefaultAcceptTypes(type: 'image' | 'video' | 'file'): string {
  const defaultAcceptTypes = {
    image: 'image/*',
    video: 'video/*',
    file: 'image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv'
  };
  return defaultAcceptTypes[type];
}

/** Extrait le nom de fichier d'une URL ou data URL */
function extractFileName(url: string, fallback = 'Fichier'): string {
  // Si c'est une data URL, utiliser le fallback avec l'extension détectée
  if (url.startsWith('data:')) {
    const mimeMatch = url.match(/data:([^;]+)/);
    if (mimeMatch) {
      const mimeType = mimeMatch[1];
      const extensions: Record<string, string> = {
        'application/pdf': 'pdf',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'text/plain': 'txt',
        'text/csv': 'csv'
      };
      const ext = extensions[mimeType] || 'fichier';
      return `${fallback}.${ext}`;
    }
    return fallback;
  }

  // Pour les URLs normales, extraire le nom de fichier
  const fileName = url.split('/').pop();
  return fileName && fileName.length > 0 ? decodeURIComponent(fileName) : fallback;
}

/** Mélange un tableau de façon stable pour une vie de composant (Fisher–Yates). */
function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Renvoie les options dans l'ordre du builder ou mélangées, selon la config. */
function useDisplayOptions(field: Field): FieldOption[] {
  const shouldRandomize = field.validation?.randomize_options ?? false;
  // useMemo sur l'identité du champ + flag : on mélange une seule fois par montage,
  // pas à chaque re-render (sinon les options sauteraient quand l'utilisateur tape).
  return useMemo(
    () => (shouldRandomize ? shuffled(field.options ?? []) : field.options ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [field.id, shouldRandomize]
  );
}

interface Props {
  field: Field;
  /** En mode preview (builder), les champs qui collectent une réponse ne sont PAS interactifs.
   *  Le créateur ne doit pas pouvoir cliquer une étoile, un NPS, etc. */
  preview?: boolean;
  /** Si true, force la mise en page mobile (1 colonne pour les options). */
  mobile?: boolean;
  /** Fonction pour modifier le champ (utilisée dans le builder). */
  onChange?: (patch: Partial<Field>) => void;
  /** Style global appliqué à toutes les questions (depuis form.theme.field_style). */
  globalStyle?: any;
  /** Valeur actuelle du champ (mode interactif). */
  value?: any;
  /** Callback appelé lors de la modification de la valeur. */
  onValueChange?: (val: any) => void;
  /**
   * Toutes les réponses du formulaire — nécessaire aux seuls champs calculés,
   * dont la valeur se lit ailleurs que dans la leur.
   */
  responses?: Record<string, unknown>;
  /**
   * Devise et compteurs, quand le formulaire affiche un total.
   *
   * Les quantités ne vivent pas dans la valeur du champ mais dans une clé
   * voisine des réponses (`<champ>__qty`) : leur écriture passe donc par un
   * rappel distinct de `onValueChange`.
   */
  pricing?: RendererPricing;
  /**
   * L'intitulé de la question est rendu à l'extérieur, avec les identifiants
   * convenus (`lib/field-labelling`). Le champ s'y rattache alors : le contrôle
   * unique prend un `id` et un `aria-labelledby`, la question à plusieurs
   * contrôles est enveloppée dans un groupe nommé.
   *
   * Faux dans le constructeur, où la question et son aperçu vivent dans la même
   * carte, et où deux aperçus du même champ peuvent coexister à l'écran : deux
   * éléments porteraient alors le même identifiant.
   */
  labelled?: boolean;
}

/**
 * Rendu UI d'un champ — constructeur (aperçu) comme vue publique.
 *
 * Une question à plusieurs contrôles — choix, note, matrice, oui/non — n'a pas
 * « son » champ à nommer : désigner le premier bouton par un `<label for>`
 * dirait à un lecteur d'écran que l'intitulé appartient à cette option-là.
 * L'ensemble est donc annoncé comme un groupe portant l'intitulé pour nom, et
 * chaque contrôle garde le sien.
 */
export function FieldRenderer(props: Props) {
  const { field, labelled } = props;

  if (!labelled || !isGroupedField(field.type)) return <FieldControl {...props} />;

  return (
    <div
      role="group"
      aria-labelledby={fieldLabelId(field.id)}
      aria-describedby={field.description?.fr ? fieldDescriptionId(field.id) : undefined}
    >
      <FieldControl {...props} />
    </div>
  );
}

function FieldControl({
  field,
  preview = false,
  mobile = false,
  onChange,
  globalStyle,
  value,
  onValueChange,
  responses,
  pricing,
  labelled = false
}: Props) {
  const lang = 'fr';
  /** Vide pour une question à plusieurs contrôles : le groupe porte son nom. */
  const attrs: ControlAttrs = labelled ? controlAttrsFor(field) : {};
  // Un champ ne collecte réellement une réponse que si quelqu'un l'écoute.
  const isInteractive = typeof onValueChange === 'function';
  const placeholder = field.placeholder?.[lang] ?? '';
  const required = field.required;
  const baseInput =
    'w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden disabled:cursor-default disabled:opacity-100';

  switch (field.type) {
    case 'short_text': {
      return (
        <ShortTextWithCounter
          field={field}
          controlAttrs={attrs}
          placeholder={placeholder || 'Votre réponse'}
          required={required}
          preview={preview}
          onChange={onChange}
          value={value}
          onValueChange={onValueChange}
        />
      );
    }

    case 'email':
      return (
        <ValidatedTextInput
          name={field.id}
          type="email"
          controlAttrs={attrs}
          required={required && !preview}
          maxLength={LIMITS.EMAIL_MAX_CHARS}
          placeholder={placeholder || 'vous@exemple.com'}
          baseInput={baseInput}
          preview={preview}
          onChange={onChange}
          field={field}
          value={value}
          onValueChange={onValueChange}
        />
      );

    case 'url':
      return (
        <ValidatedTextInput
          name={field.id}
          type="url"
          controlAttrs={attrs}
          required={required && !preview}
          maxLength={LIMITS.URL_MAX_CHARS}
          placeholder={placeholder || 'https://exemple.com'}
          baseInput={baseInput}
          preview={preview}
          onChange={onChange}
          field={field}
          value={value}
          onValueChange={onValueChange}
        />
      );

    case 'long_text': {
      return (
        <LongTextWithCounter
          field={field}
          controlAttrs={attrs}
          placeholder={placeholder || 'Votre réponse…'}
          required={required}
          preview={preview}
          onChange={onChange}
          value={value}
          onValueChange={onValueChange}
        />
      );
    }

    case 'number':
      return (
        <NumberInputWithValidation
          field={field}
          controlAttrs={attrs}
          placeholder={placeholder || '4'}
          required={required}
          preview={preview}
          baseInput={baseInput}
          onChange={onChange}
          value={value}
          onValueChange={onValueChange}
        />
      );

    case 'phone':
      if (onChange) {
        return (
          <BuilderPhoneField
            placeholder={placeholder}
            onChange={onChange}
            field={field}
          />
        );
      }
      // Pour l'aperçu et le mode répondant réel, on utilise RespondentPhoneField 
      // pour que le sélecteur de pays et les placeholders dynamiques fonctionnent parfaitement.
      return (
        <RespondentPhoneField
          name={field.id}
          required={required}
          placeholder={placeholder}
          value={value}
          onChange={(val: string) => onValueChange && onValueChange(val)}
        />
      );

    case 'date':
      return (
        <div className="relative w-full">
          <input
            {...attrs}
            type="date"
            name={field.id}
            required={required && !preview}
            className={cn(
              baseInput,
              'w-full min-w-0 box-border py-3.5 pr-10 appearance-none',
              '[&::-webkit-calendar-picker-indicator]:hidden',
              !value && 'text-transparent'
            )}
            disabled={preview}
            value={value || ''}
            onChange={(e) => onValueChange && onValueChange(e.target.value)}
          />
          {!value && (
            <div className="pointer-events-none absolute inset-0 flex items-center px-3">
              <span className="text-sm text-text-tertiary">jj / mm / aaaa</span>
            </div>
          )}
          <Calendar className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
        </div>
      );

    case 'single_choice':
      return (
        <SingleChoice
          field={field}
          pricing={pricing}
          preview={preview}
          mobile={mobile}
          required={required}
          value={value}
          onChange={onValueChange}
        />
      );

    case 'multiple_choice':
      return (
        <MultipleChoice
          field={field}
          pricing={pricing}
          preview={preview}
          mobile={mobile}
          required={required}
          value={value}
          onChange={onValueChange}
        />
      );

    case 'dropdown':
      return (
        <DropdownChoice
          field={field}
          controlAttrs={attrs}
          pricing={pricing}
          preview={preview}
          baseInput={baseInput}
          required={required}
          value={value}
          onChange={onValueChange}
        />
      );

    case 'rating': {
      const max = field.validation?.max ?? 5;
      return (
        <Rating
          max={max}
          preview={preview}
          value={value}
          onChange={onValueChange}
        />
      );
    }

    case 'nps':
      return (
        <NpsScale
          field={field}
          preview={preview}
          value={value}
          onChange={onValueChange}
        />
      );

    case 'file':
      return (
        <MediaField
          field={field}
          preview={preview}
          required={required}
          type="file"
          onChange={onChange}
          globalStyle={globalStyle}
          value={value}
          onValueChange={onValueChange}
        />
      );

    case 'matrix':
      return (
        <MatrixField
          field={field}
          preview={preview}
          value={value}
          onChange={onValueChange}
        />
      );

    case 'image':
      return (
        <MediaField
          field={field}
          preview={preview}
          required={required}
          type="image"
          onChange={onChange}
          globalStyle={globalStyle}
          value={value}
          onValueChange={onValueChange}
        />
      );

    case 'video':
      return (
        <MediaField
          field={field}
          preview={preview}
          required={required}
          type="video"
          onChange={onChange}
          globalStyle={globalStyle}
          value={value}
          onValueChange={onValueChange}
        />
      );

    // Les dix types de la phase 2. `interactive` vaut la présence d'un
    // `onValueChange` : le canevas du constructeur n'en fournit pas, la vue
    // publique si. C'est le seul signal fiable — `preview` vaut `false` des deux
    // côtés.
    case 'currency':
      return (
        <CurrencyField
          field={field}
          controlProps={attrs}
          placeholder={placeholder}
          interactive={isInteractive}
          value={value}
          onValueChange={onValueChange}
        />
      );

    case 'address':
      return (
        <AutoTextarea
          {...attrs}
          value={isInteractive ? String(value ?? '') : ''}
          onChange={(event) => onValueChange?.(event.target.value)}
          disabled={!isInteractive}
          minRows={field.validation?.address_rows ?? 3}
          autoComplete="street-address"
          placeholder={placeholder || 'Rue, ville, code postal, pays'}
          maxLength={LIMITS.LONG_TEXT_MAX_CHARS}
          className={cn(baseInput, 'resize-none')}
        />
      );

    case 'country':
      return (
        <CountryField
          field={field}
          controlProps={attrs}
          interactive={isInteractive}
          value={value}
          onValueChange={onValueChange}
        />
      );

    case 'yesno':
      return (
        <YesNoField
          field={field}
          interactive={isInteractive}
          value={value}
          onValueChange={onValueChange}
        />
      );

    case 'signature':
      return (
        <SignatureField
          field={field}
          interactive={isInteractive}
          value={value}
          onValueChange={onValueChange}
        />
      );

    case 'repeater':
      return (
        <RepeaterField
          field={field}
          pricing={pricing}
          interactive={isInteractive}
          mobile={mobile}
          value={value}
          onValueChange={onValueChange}
        />
      );

    case 'calculated':
      return <CalculatedField field={field} responses={responses} controlProps={attrs} />;

    case 'link':
      return <LinkField field={field} builder={!isInteractive} />;

    case 'hidden':
      return <HiddenField field={field} builder={!isInteractive} value={value} />;

    case 'divider':
      return <hr className="my-1 border-t border-border" />;

    case 'statement':
      // Géré par FieldCard (rendu spécial)
      return null;

    default:
      return null;
  }
}

/**
 * Libellé d'une option de liste déroulante, prix compris.
 *
 * Une `<option>` native n'accepte que du texte : le prix ne peut pas y être un
 * élément à part, comme ailleurs. Il est donc concaténé.
 */
function optionTextWithPrice(
  option: FieldOption,
  index: number,
  pricing?: RendererPricing
): string {
  const label = option.label.fr || `Option ${index + 1}`;
  if (!pricing?.enabled || !option.price) return label;
  return `${label} — ${formatMoney(option.price, pricing.currency, pricing.position)}`;
}

function EmptyOptions() {
  return (
    <div className="rounded-md border border-dashed border-border-strong bg-bg-base px-3 py-2 text-xs text-text-tertiary">
      Aucune option — ajoutez-en dans le panneau de droite
    </div>
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^https?:\/\/[^\s]+$/i;

function ValidatedTextInput({
  name,
  type,
  controlAttrs,
  maxLength,
  placeholder,
  baseInput,
  preview,
  required,
  onChange,
  field,
  value: controlledValue,
  onValueChange
}: {
  name?: string;
  type: 'email' | 'url';
  controlAttrs?: ControlAttrs;
  maxLength: number;
  placeholder: string;
  baseInput: string;
  preview: boolean;
  required?: boolean;
  onChange?: (patch: Partial<Field>) => void;
  field?: Field;
  value?: string;
  onValueChange?: (val: string) => void;
}) {
  const [localValue, setLocalValue] = useState('');
  const [touched, setTouched] = useState(false);
  const value = controlledValue !== undefined ? controlledValue : localValue;
  const handleValueChange = (val: string) => {
    if (onValueChange) onValueChange(val);
    else setLocalValue(val);
  };

  if (onChange && field) {
    const defaultPlaceholder = type === 'email' ? 'vous@exemple.com' : 'https://exemple.com';
    return (
      <input
        type="text"
        value={field.placeholder?.fr ?? ''}
        onChange={(e) => {
          const current = field.placeholder ?? {};
          onChange({ placeholder: { ...current, fr: e.target.value } });
        }}
        placeholder={placeholder || defaultPlaceholder}
        className="w-full rounded-md border border-dashed border-border-strong bg-transparent px-3 py-2 text-sm text-text-tertiary placeholder:text-text-tertiary/40 focus:border-accent focus:bg-bg-elevated/50 focus:outline-hidden"
      />
    );
  }

  let error: string | null = null;
  if (touched && value) {
    if (type === 'email' && !EMAIL_REGEX.test(value)) {
      error = 'Email invalide — il doit contenir « @ » et un domaine.';
    } else if (type === 'url' && !URL_REGEX.test(value)) {
      error = 'URL invalide — doit commencer par http:// ou https://';
    }
  }

  const currentLength = value.length;
  const isNearLimit = currentLength > maxLength * 0.8;
  const isAtLimit = currentLength >= maxLength;

  return (
    <div className="space-y-1">
      <input
        {...controlAttrs}
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        value={value}
        onChange={(e) => handleValueChange(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        disabled={preview}
        className={cn(
          baseInput,
          'wrap-break-word overflow-hidden', // Empêche le débordement
          error ? 'border-danger focus:border-danger' : '',
          isAtLimit && !preview && 'border-orange-400 focus:border-orange-400'
        )}
        style={{
          wordBreak: 'break-word',
          overflowWrap: 'break-word'
        }}
      />

      {/* Compteur de caractères pour email/url */}
      {!preview && maxLength && (
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">
            {currentLength}/{maxLength} caractères
          </span>
          {isNearLimit && (
            <span className={cn(
              'font-medium',
              isAtLimit ? 'text-danger' : 'text-orange-600'
            )}>
              {isAtLimit ? 'Limite atteinte' : 'Proche de la limite'}
            </span>
          )}
        </div>
      )}

      {/* Mode preview : affiche seulement la limite */}
      {preview && maxLength && (
        <p className="text-xs text-text-tertiary">
          Maximum {maxLength} caractères
        </p>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

const OTHER_VALUE = '__other__';

function optionsGridClass(cols: number, mobile: boolean): string {
  if (mobile || cols === 1) return 'space-y-2';
  if (cols === 3) return 'grid grid-cols-3 gap-2';
  return 'grid grid-cols-2 gap-2';
}

function SingleChoice({
  field,
  pricing,
  preview,
  mobile,
  required,
  value,
  onChange
}: {
  field: Field;
  pricing?: RendererPricing;
  preview: boolean;
  mobile: boolean;
  required?: boolean;
  value?: string;
  onChange?: (val: string) => void;
}) {
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selected = value !== undefined ? value : localSelected;
  const setSelected = (val: string) => {
    if (onChange) onChange(val);
    else setLocalSelected(val);
  };

  const [otherText, setOtherText] = useState('');
  const hasOther = field.validation?.has_other ?? false;
  const otherLabel = field.validation?.other_label || 'Autre';
  const cols = field.validation?.options_columns ?? 1;
  const style = field.validation?.display_style ?? 'buttons';
  const isButtons = style === 'buttons';
  const displayOptions = useDisplayOptions(field);

  // Rendu en boutons pleins (radio caché, bouton visible).
  if (isButtons) {
    return (
      <div className="space-y-2">
        {/* Validation native cachée : un radio required invisible pour bloquer si rien n'est coché. */}
        {required && !preview && (
          <input
            type="radio"
            name={field.id}
            tabIndex={-1}
            required
            checked={selected !== null}
            onChange={() => {}}
            onInvalid={(e) =>
              (e.target as HTMLInputElement).setCustomValidity('Choisis une option.')
            }
            onInput={(e) => (e.target as HTMLInputElement).setCustomValidity('')}
            style={{
              position: 'absolute',
              opacity: 0,
              pointerEvents: 'none',
              height: 0,
              width: 0
            }}
            aria-hidden
          />
        )}
        <div className={optionsGridClass(cols, mobile)}>
          {displayOptions.length === 0 && !hasOther && <EmptyOptions />}
          {displayOptions.map((opt, i) => {
            const active = selected === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={preview}
                onClick={() => !preview && setSelected(opt.id)}
                className={cn(
                  'w-full wrap-break-word rounded-md border px-3 py-2 text-center text-sm transition',
                  active
                    ? 'border-accent bg-accent text-mooove-ice'
                    : 'border-border-strong bg-bg-base text-text-primary',
                  preview ? 'cursor-default' : 'cursor-pointer hover:border-accent'
                )}
              >
                {opt.label.fr || `Option ${i + 1}`}
                <OptionPrice option={opt} pricing={pricing} />
              </button>
            );
          })}
          {hasOther && (
            <button
              type="button"
              disabled={preview}
              onClick={() => !preview && setSelected(OTHER_VALUE)}
              className={cn(
                'w-full wrap-break-word rounded-md border px-3 py-2 text-center text-sm italic transition',
                selected === OTHER_VALUE
                  ? 'border-accent bg-accent text-mooove-ice'
                  : 'border-border-strong bg-bg-base text-text-secondary',
                preview ? 'cursor-default' : 'cursor-pointer hover:border-accent'
              )}
            >
              {otherLabel}
            </button>
          )}
        </div>
        {hasOther && selected === OTHER_VALUE && (
          <input
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            disabled={preview}
            placeholder="Précisez…"
            maxLength={200}
            className="w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden wrap-break-word overflow-hidden"
            style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
          />
        )}
        <QuantityRow field={field} value={selected} pricing={pricing} />
      </div>
    );
  }

  // Rendu en cartes (radio classique visible).
  return (
    <div className="space-y-2">
      <div className={optionsGridClass(cols, mobile)}>
        {displayOptions.length === 0 && !hasOther && <EmptyOptions />}
        {displayOptions.map((opt, i) => (
          <label
            key={opt.id}
            className={`flex items-center gap-2.5 rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary transition has-[:checked]:border-accent has-[:checked]:bg-accent/5 ${
              preview ? 'cursor-default' : 'cursor-pointer hover:border-accent'
            }`}
          >
            <input
              type="radio"
              name={field.id}
              value={opt.id}
              required={required && !preview}
              disabled={preview}
              checked={selected === opt.id}
              onChange={() => setSelected(opt.id)}
              className="h-4 w-4"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span className="wrap-break-word">
              {opt.label.fr || `Option ${i + 1}`}
              <OptionPrice option={opt} pricing={pricing} />
            </span>
          </label>
        ))}
      </div>
      {hasOther && (
        <div>
          <label
            className={`flex items-center gap-2.5 rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary transition has-[:checked]:border-accent has-[:checked]:bg-accent/5 ${
              preview ? 'cursor-default' : 'cursor-pointer hover:border-accent'
            }`}
          >
            <input
              type="radio"
              name={field.id}
              disabled={preview}
              checked={selected === OTHER_VALUE}
              onChange={() => setSelected(OTHER_VALUE)}
              className="h-4 w-4"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span className="wrap-break-word italic text-text-secondary">{otherLabel}</span>
          </label>
          {selected === OTHER_VALUE && (
            <input
              type="text"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              disabled={preview}
              placeholder="Précisez…"
              className="mt-1 w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden"
            />
          )}
        </div>
      )}
      <QuantityRow field={field} value={selected} pricing={pricing} />
    </div>
  );
}

function MultipleChoice({
  field,
  pricing,
  preview,
  mobile,
  required,
  value,
  onChange
}: {
  field: Field;
  pricing?: RendererPricing;
  preview: boolean;
  mobile: boolean;
  required?: boolean;
  value?: string[];
  onChange?: (val: string[]) => void;
}) {
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());
  const selected = useMemo(() => {
    if (value !== undefined) return new Set(value);
    return localSelected;
  }, [value, localSelected]);

  const [otherText, setOtherText] = useState('');
  // Réponses aux sous-questions : { [optionId]: { [subfieldId]: string } }
  const [subAnswers, setSubAnswers] = useState<Record<string, Record<string, string>>>({});
  const hasOther = field.validation?.has_other ?? false;
  const otherLabel = field.validation?.other_label || 'Autre';
  const cols = field.validation?.options_columns ?? 1;
  const hasSubfields = field.validation?.has_subfields ?? false;
  const subfields = field.subfields ?? [];
  const min = field.validation?.selection_min;
  const max = field.validation?.selection_max;
  const displayOptions = useDisplayOptions(field);

  function toggle(id: string) {
    const nextSet = new Set(selected);
    if (nextSet.has(id)) {
      nextSet.delete(id);
    } else {
      if (typeof max === 'number' && nextSet.size >= max) return;
      nextSet.add(id);
    }

    if (onChange) {
      onChange(Array.from(nextSet));
    } else {
      setLocalSelected(nextSet);
    }
  }

  function setSubAnswer(optId: string, sfId: string, value: string) {
    setSubAnswers((prev) => ({
      ...prev,
      [optId]: { ...(prev[optId] ?? {}), [sfId]: value }
    }));
  }

  const totalChecked = selected.size;
  // La sélection est valide si elle respecte min/max ET la contrainte required.
  const minOk = typeof min === 'number' ? totalChecked >= min : true;
  const maxOk = typeof max === 'number' ? totalChecked <= max : true;
  const selectionValid = minOk && maxOk && (!required || totalChecked > 0);

  const limitMessage = formatLimitMessage(min, max);
  const errorMessage = !minOk
    ? `Choisis au moins ${min} option${(min ?? 0) > 1 ? 's' : ''}.`
    : !maxOk
      ? `Maximum ${max} option${(max ?? 0) > 1 ? 's' : ''}.`
      : required && totalChecked === 0
        ? 'Coche au moins une option.'
        : null;

  return (
    <div className="space-y-2">
      {/* Champ caché pour validation native : exprime la validité combinée required + min/max */}
      {!preview && (required || typeof min === 'number' || typeof max === 'number') && (
        <input
          type="text"
          tabIndex={-1}
          required
          value={selectionValid ? '1' : ''}
          onChange={() => {}}
          onInvalid={(e) =>
            (e.target as HTMLInputElement).setCustomValidity(errorMessage || 'Sélection invalide.')
          }
          onInput={(e) => (e.target as HTMLInputElement).setCustomValidity('')}
          style={{
            position: 'absolute',
            opacity: 0,
            pointerEvents: 'none',
            height: 0,
            width: 0
          }}
          aria-hidden
        />
      )}

      {/* Sous-questions activées : chaque option occupe une ligne pour pouvoir
          afficher les sous-champs en dessous quand l'option est cochée. */}
      {hasSubfields ? (
        <div className="space-y-2">
          {displayOptions.length === 0 && !hasOther && <EmptyOptions />}
          {displayOptions.map((opt, i) => {
            const checked = selected.has(opt.id);
            return (
              <div key={opt.id}>
                <label
                  className={`flex items-center gap-2.5 rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary transition has-[:checked]:border-accent has-[:checked]:bg-accent/5 ${
                    preview ? 'cursor-default' : 'cursor-pointer hover:border-accent'
                  }`}
                >
                  <input
                    type="checkbox"
                    name={field.id}
                    value={opt.id}
                    disabled={preview}
                    checked={checked}
                    onChange={() => toggle(opt.id)}
                    className="h-4 w-4 rounded-sm"
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <span className="wrap-break-word">
              {opt.label.fr || `Option ${i + 1}`}
              <OptionPrice option={opt} pricing={pricing} />
            </span>
                </label>
                {checked && subfields.length > 0 && (
                  <div className="ml-6 mt-2 space-y-3 border-l-2 border-accent/30 pl-4">
                    {subfields.map((sf) => (
                      <SubfieldRenderer
                        key={`${opt.id}-${sf.id}`}
                        subfield={sf}
                        optionId={opt.id}
                        value={subAnswers[opt.id]?.[sf.id] ?? ''}
                        onChange={(v) => setSubAnswer(opt.id, sf.id, v)}
                        preview={preview}
                        mobile={mobile}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={optionsGridClass(cols, mobile)}>
          {displayOptions.length === 0 && !hasOther && <EmptyOptions />}
          {displayOptions.map((opt, i) => (
            <label
              key={opt.id}
              className={`flex items-center gap-2.5 rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary transition has-[:checked]:border-accent has-[:checked]:bg-accent/5 ${
                preview ? 'cursor-default' : 'cursor-pointer hover:border-accent'
              }`}
            >
              <input
                type="checkbox"
                name={field.id}
                value={opt.id}
                disabled={preview}
                checked={selected.has(opt.id)}
                onChange={() => toggle(opt.id)}
                className="h-4 w-4 rounded-sm"
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="wrap-break-word">
              {opt.label.fr || `Option ${i + 1}`}
              <OptionPrice option={opt} pricing={pricing} />
            </span>
            </label>
          ))}
        </div>
      )}

      {hasOther && (
        <div>
          <label
            className={`flex items-center gap-2.5 rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary transition has-[:checked]:border-accent has-[:checked]:bg-accent/5 ${
              preview ? 'cursor-default' : 'cursor-pointer hover:border-accent'
            }`}
          >
            <input
              type="checkbox"
              disabled={preview}
              checked={selected.has(OTHER_VALUE)}
              onChange={() => toggle(OTHER_VALUE)}
              className="h-4 w-4 rounded-sm"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span className="wrap-break-word italic text-text-secondary">{otherLabel}</span>
          </label>
          {selected.has(OTHER_VALUE) && (
            <input
              type="text"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              disabled={preview}
              placeholder="Précisez…"
              className="mt-1 w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden"
            />
          )}
        </div>
      )}

      {/* Indication sur la plage autorisée — rouge si la sélection est hors plage */}
      {limitMessage && (
        <p
          className={cn(
            'text-[11px] italic',
            minOk && maxOk ? 'text-text-tertiary' : 'font-medium not-italic text-danger'
          )}
        >
          {limitMessage} · {totalChecked} coché{totalChecked > 1 ? 's' : ''}
        </p>
      )}
      <QuantityRow field={field} value={[...selected]} pricing={pricing} />
    </div>
  );
}

function formatLimitMessage(min?: number, max?: number): string | null {
  if (typeof min === 'number' && typeof max === 'number') {
    if (min === max) return `Choisis exactement ${min} option${min > 1 ? 's' : ''}`;
    return `Choisis entre ${min} et ${max} options`;
  }
  if (typeof min === 'number') return `Choisis au moins ${min} option${min > 1 ? 's' : ''}`;
  if (typeof max === 'number') return `Choisis jusqu'à ${max} option${max > 1 ? 's' : ''}`;
  return null;
}

/** Rendu d'un sous-champ sous une option cochée — délègue à FieldRenderer en adaptant la forme. */
function SubfieldRenderer({
  subfield,
  optionId,
  value,
  onChange,
  preview,
  mobile
}: {
  subfield: SubField;
  /** ID de l'option parente cochée — sert à isoler ce sous-champ des autres répétitions
   *  (sinon toutes les radios "privé/partagé" partagent le même name et se comportent comme un seul groupe). */
  optionId: string;
  value: string;
  onChange: (value: string) => void;
  preview: boolean;
  mobile: boolean;
}) {
  // On compose l'id : { optionId }__{ subfieldId } — c'est aussi le format prévu pour
  // la colonne SQL (lib/submission-columns.ts) à la soumission.
  const compositeId = `${optionId}__${subfield.id}`;

  // On adapte le SubField en pseudo-Field pour réutiliser FieldRenderer. L'id composite
  // garantit l'unicité des `name` HTML pour chaque répétition.
  const pseudoField: Field = {
    id: compositeId,
    form_id: '',
    // Un pseudo-champ n'est jamais enregistré : il n'appartient à aucune section.
    section_id: '',
    type: subfield.type,
    label: subfield.label,
    description: subfield.description,
    placeholder: subfield.placeholder,
    options: subfield.options,
    rows: subfield.rows,
    required: subfield.required,
    field_order: 0,
    validation: subfield.validation,
    style: subfield.style
  };

  return (
    <div className="space-y-1">
      <label className="block text-xs text-text-secondary">
        {subfield.label.fr || 'Sous-question'}
        {subfield.required && <span className="ml-1 text-danger">*</span>}
      </label>
      <FieldRenderer field={pseudoField} preview={preview} mobile={mobile} />
      {/* On garde value/onChange pour la persistance localStorage (save & resume) future :
          la collecte se fait par DOM/FormData côté soumission. */}
      <input type="hidden" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function DropdownChoice({
  field,
  controlAttrs,
  pricing,
  preview,
  baseInput,
  required,
  value,
  onChange
}: {
  field: Field;
  controlAttrs?: ControlAttrs;
  pricing?: RendererPricing;
  preview: boolean;
  baseInput: string;
  required?: boolean;
  value?: string;
  onChange?: (val: string) => void;
}) {
  const [localValue, setLocalValue] = useState('');
  const currentValue = value !== undefined ? value : localValue;
  const handleValueChange = (val: string) => {
    if (onChange) onChange(val);
    else setLocalValue(val);
  };

  const [otherText, setOtherText] = useState('');
  const hasOther = field.validation?.has_other ?? false;
  const otherLabel = field.validation?.other_label || 'Autre';
  const displayOptions = useDisplayOptions(field);

  return (
    <div className="space-y-2">
      <select
        {...controlAttrs}
        name={field.id}
        className={baseInput}
        disabled={preview}
        required={required && !preview}
        value={currentValue}
        onChange={(e) => handleValueChange(e.target.value)}
      >
        <option value="" disabled>
          Sélectionner…
        </option>
        {displayOptions.map((opt, i) => (
          <option key={opt.id} value={opt.id}>
            {optionTextWithPrice(opt, i, pricing)}
          </option>
        ))}
        {hasOther && <option value={OTHER_VALUE}>{otherLabel}</option>}
      </select>
      {hasOther && currentValue === OTHER_VALUE && (
        <input
          type="text"
          value={otherText}
          onChange={(e) => setOtherText(e.target.value)}
          disabled={preview}
          placeholder="Précisez…"
          className={baseInput}
        />
      )}
    </div>
  );
}

function Rating({
  max,
  preview,
  value,
  onChange
}: {
  max: number;
  preview: boolean;
  value?: number;
  onChange?: (val: number) => void;
}) {
  const [hover, setHover] = useState(0);
  const [localValue, setLocalValue] = useState(0);
  const currentValue = value !== undefined ? value : localValue;
  const handleValueChange = (val: number) => {
    if (onChange) onChange(val);
    else setLocalValue(val);
  };

  if (preview) {
    return (
      <div className="flex items-center gap-1.5">
        {Array.from({ length: max }).map((_, i) => (
          <Star key={i} className="h-7 w-7 text-text-tertiary" strokeWidth={1.5} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: max }).map((_, i) => {
        const filled = (hover || currentValue) > i;
        return (
          <button
            key={i}
            type="button"
            onMouseEnter={() => setHover(i + 1)}
            onMouseLeave={() => setHover(0)}
            onClick={() => handleValueChange(i + 1)}
            className="transition"
            aria-label={`Note ${i + 1}`}
          >
            <Star
              className={`h-7 w-7 transition ${filled ? 'fill-mooove-amber text-mooove-amber' : 'text-text-tertiary'}`}
              strokeWidth={1.5}
            />
          </button>
        );
      })}
    </div>
  );
}

function NpsScale({
  field,
  preview,
  value,
  onChange
}: {
  field?: Field;
  preview: boolean;
  value?: number | null;
  onChange?: (val: number) => void;
}) {
  const [localValue, setLocalValue] = useState<number | null>(null);
  const currentValue = value !== undefined ? value : localValue;

  const min = field?.validation?.min ?? 0;
  const max = field?.validation?.max ?? 10;
  const leftLabel = field?.validation?.nps_left_label || "Pas du tout probable";
  const rightLabel = field?.validation?.nps_right_label || "Extrêmement probable";
  const displayStyle = field?.validation?.display_style ?? 'buttons';

  const handleValueChange = (val: number) => {
    if (onChange) onChange(val);
    else setLocalValue(val);
  };

  const values = Array.from({ length: Math.max(1, max - min + 1) }).map((_, i) => min + i);

  const renderContent = () => {
    if (displayStyle === 'slider') {
      const hasValue = currentValue !== null && currentValue !== undefined;

      return (
        <div className="scale-slider-wrapper flex items-center gap-3 w-full py-1">
          <input
            type="range"
            min={min}
            max={max}
            step={1}
            disabled={preview}
            value={hasValue ? currentValue : Math.round((min + max) / 2)}
            onChange={(e) => handleValueChange(Number(e.target.value))}
            className={cn(
              "scale-slider grow flex-1 appearance-none h-1 bg-border-strong rounded-lg cursor-pointer outline-hidden transition-all",
              "focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-(--accent) [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-125 [&::-webkit-slider-thumb]:shadow-xs",
              "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-(--accent) [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:transition-transform [&::-moz-range-thumb]:hover:scale-110 [&::-moz-range-thumb]:active:scale-125 [&::-moz-range-thumb]:shadow-xs"
            )}
          />
          <span className="scale-slider-value text-sm font-semibold text-accent font-mono min-w-[28px] text-right shrink-0 select-none">
            {hasValue ? currentValue : '—'}
          </span>
        </div>
      );
    }

    // Default buttons
    return (
      <div className="flex flex-wrap gap-1.5">
        {values.map((val) => (
          <button
            key={val}
            type="button"
            disabled={preview}
            onClick={() => handleValueChange(val)}
            className={cn(
              "h-9 w-9 rounded-md border text-sm font-medium transition disabled:cursor-default",
              currentValue === val && !preview
                ? "border-accent bg-accent text-mooove-ice"
                : "border-border-strong bg-bg-base text-text-primary",
              !preview && "hover:border-accent"
            )}
          >
            {val}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {renderContent()}
      <div className="scale-slider-labels flex justify-between px-1 text-xs text-text-tertiary select-none">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}


/** Interface de sélection des modes pour les champs Media */
function ModeSelector({ field, type, labels, onChange }: {
  field: Field;
  type: 'image' | 'video' | 'file';
  labels: { creator: string; respondent: string };
  onChange?: (patch: Partial<Field>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload: uploadFile, uploading, progress } = useAttachmentUpload();

  function patchValidation(patch: Partial<import('@/types').FieldValidation>) {
    if (!onChange) return;
    onChange({ validation: { ...field.validation, ...patch } });
  }

  function handleCreatorClick() {
    patchValidation({ creator_mode_enabled: true });

    // Pour image/fichier, ouvrir directement le sélecteur avec fallback
    if ((type === 'image' || type === 'file') && fileInputRef.current) {
      setTimeout(() => {
        try {
          fileInputRef.current?.click();
        } catch (error) {
          console.warn('Impossible d\'ouvrir automatiquement le sélecteur de fichier:', error);
        }
      }, 150);
    }
  }

  /**
   * Le fichier est téléversé puis référencé par son URL : images et vidéos vers
   * Cloudflare R2, documents vers Supabase Storage. Le formulaire ne contient
   * plus jamais le fichier lui-même.
   */
  async function handleFileUpload(file: File) {
    const allowedExtensions = {
      image: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.avif'],
      video: ['.mp4', '.mov', '.webm', '.m4v'],
      file: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv']
    };

    const fileExt = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
    if (!allowedExtensions[type].includes(fileExt)) {
      toast.error(`Format non supporté. Extensions autorisées : ${allowedExtensions[type].join(', ')}`);
      return;
    }

    const url = await uploadFile(file);
    if (url) patchValidation({ media_url: url });
  }

  const typeDescriptions = {
    image: { creator: "Ajoutez une image qui s'affiche", respondent: "Le répondant peut envoyer une image" },
    video: { creator: "Ajoutez une vidéo qui s'affiche", respondent: "Le répondant peut envoyer une vidéo" },
    file: { creator: "Ajoutez un fichier téléchargeable", respondent: "Le répondant peut envoyer un fichier" }
  };

  const desc = typeDescriptions[type];

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-sm font-medium text-text-primary">Choix du mode</p>
        <p className="text-xs text-text-secondary">
          Choisissez comment ce champ fonctionnera
        </p>
      </div>

      <div className="rounded-xl border-2 border-red-500 border-dashed bg-red-50/50 p-3">
        <div className="grid grid-cols-2 gap-3">
          {/* Zone Créateur */}
          <button
            type="button"
            onClick={handleCreatorClick}
            className="group relative flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-accent/30 bg-bg-base p-6 text-center transition-all hover:border-accent hover:bg-accent/5"
          >
            <Upload className="h-8 w-8 text-accent" />
            <div className="space-y-1">
              <h4 className="font-medium text-text-primary">{labels.creator}</h4>
              <p className="text-xs text-text-tertiary">{desc.creator}</p>
            </div>
            <span className="rounded-md bg-accent/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
              Créateur
            </span>
          </button>

          {/* Zone Répondant */}
          <button
            type="button"
            onClick={() => patchValidation({ respondent_mode_enabled: true })}
            className="group relative flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-mooove-cyan/30 bg-bg-base p-6 text-center transition-all hover:border-mooove-cyan hover:bg-mooove-cyan/5"
          >
            <div className="h-8 w-8 flex items-center justify-center text-mooove-cyan">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-text-primary">{labels.respondent}</h4>
              <p className="text-xs text-text-tertiary">{desc.respondent}</p>
            </div>
            <span className="rounded-md bg-mooove-cyan/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-mooove-cyan">
              Répondant
            </span>
          </button>
        </div>

        {uploading && (
          <p className="text-center text-xs text-text-secondary" role="status">
            Envoi en cours… {progress}%
          </p>
        )}

        {/* Input caché pour sélection de fichier */}
        <input
          ref={fileInputRef}
          type="file"
          accept={type === 'image' ? 'image/*' : type === 'file' ? '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv' : ''}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
            e.target.value = '';
          }}
        />

        {/* Message d'erreur */}
        <div className="mt-3 flex items-start gap-2 rounded-md bg-red-100 border border-red-200 px-3 py-2">
          <div className="text-red-600 mt-0.5">⚠️</div>
          <div>
            <p className="text-xs font-medium text-red-800">Veuillez choisir au moins un mode</p>
            <p className="text-xs text-red-600 mt-0.5">pour que ce champ soit fonctionnel</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Composant unifié pour Image, Vidéo, Fichier avec modes créateur/répondant */
function MediaField({ field, preview, required, type, onChange, globalStyle, value, onValueChange }: {
  field: Field;
  preview: boolean;
  required?: boolean;
  type: 'image' | 'video' | 'file';
  onChange?: (patch: Partial<Field>) => void;
  globalStyle?: any;
  value?: any;
  onValueChange?: (val: any) => void;
}) {
  const creatorModeEnabled = field.validation?.creator_mode_enabled ?? false;
  const respondentModeEnabled = field.validation?.respondent_mode_enabled ?? false;
  const mediaUrl = field.validation?.media_url;
  const alignment = field.validation?.alignment ?? 'center';

  // Labels selon le type
  const labels = {
    image: { creator: 'Ajouter une image', respondent: 'Demander une image' },
    video: { creator: 'Ajouter une vidéo', respondent: 'Demander une vidéo' },
    file: { creator: 'Ajouter un fichier', respondent: 'Demander un fichier' }
  };

  // Une vue répondant finale (soit en preview dans le builder, soit côté public réel si onChange n'est pas passé)
  const isRespondentView = preview || !onChange;

  if (isRespondentView) {
    // Utiliser la même logique pour détecter les modes actifs
    const finalCreatorModePreview = creatorModeEnabled || (mediaUrl && !respondentModeEnabled);
    const finalRespondentModePreview = respondentModeEnabled;

    return (
      <div className="space-y-4">
        {/* Contenu du créateur */}
        {finalCreatorModePreview && mediaUrl && (
          <CreatorContent type={type} mediaUrl={mediaUrl} alignment={alignment} field={field} preview={isRespondentView} globalStyle={globalStyle} />
        )}

        {/* Divider si les deux modes sont actifs */}
        {finalCreatorModePreview && finalRespondentModePreview && mediaUrl && (
          <div className="border-t border-border" />
        )}

        {/* Zone de dépôt du répondant */}
        {finalRespondentModePreview && (
          <FileUploadField
            type={type}
            enabled={true}
            required={required}
            preview={preview}
            value={value}
            onChange={onValueChange}
            accept={field.validation?.accept?.join(', ')}
          />
        )}
      </div>
    );
  }

  // DEBUG: Afficher les valeurs pour diagnostiquer
  console.log(`MediaField ${type}:`, { creatorModeEnabled, respondentModeEnabled, mediaUrl });

  // Si aucun mode n'est configuré (période de création initiale), afficher le sélecteur de mode
  if (!creatorModeEnabled && !respondentModeEnabled) {
    return <ModeSelector field={field} type={type} labels={labels[type]} onChange={onChange} />;
  }

  const finalCreatorMode = creatorModeEnabled || (mediaUrl && !respondentModeEnabled);
  const finalRespondentMode = respondentModeEnabled;

  // Si au moins un mode est sélectionné (mode builder actif), affiche seulement la zone active
  return (
    <div className="space-y-4">
      {/* Zone créateur active */}
      {finalCreatorMode && (
        <ExpandedCreatorZone
          field={field}
          type={type}
          labels={labels[type]}
          onChange={onChange}
          canSwitchMode={true}
          globalStyle={globalStyle}
        />
      )}

      {/* Zone répondant active */}
      {finalRespondentMode && !finalCreatorMode && (
        <ExpandedRespondentZone
          field={field}
          type={type}
          labels={labels[type]}
          onChange={onChange}
        />
      )}
    </div>
  );
}

/** Zone créateur agrandie après sélection */
function ExpandedCreatorZone({ field, type, labels, onChange, canSwitchMode, globalStyle }: {
  field: Field;
  type: 'image' | 'video' | 'file';
  labels: { creator: string; respondent: string };
  onChange?: (patch: Partial<Field>) => void;
  canSwitchMode: boolean;
  globalStyle?: any;
}) {
  const [urlInput, setUrlInput] = useState(field.validation?.media_url || '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload: uploadFile, uploading, progress } = useAttachmentUpload();

  function patchValidation(patch: Partial<import('@/types').FieldValidation>) {
    if (!onChange) return;
    onChange({ validation: { ...field.validation, ...patch } });
  }

  /**
   * Le fichier est téléversé puis référencé par son URL : images et vidéos vers
   * Cloudflare R2, documents vers Supabase Storage. Le formulaire ne contient
   * plus jamais le fichier lui-même.
   */
  async function handleFileUpload(file: File) {
    const allowedExtensions = {
      image: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.avif'],
      video: ['.mp4', '.mov', '.webm', '.m4v'],
      file: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv']
    };

    const fileExt = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
    if (!allowedExtensions[type].includes(fileExt)) {
      toast.error(`Format non supporté. Extensions autorisées : ${allowedExtensions[type].join(', ')}`);
      return;
    }

    const url = await uploadFile(file);
    if (url) patchValidation({ media_url: url });
  }

  return (
    <div className="space-y-3">
      {/* Header avec mode actif */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{labels.creator}</span>
          <span className="rounded-md bg-accent px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
            Créateur
          </span>
        </div>
        {canSwitchMode && (
          <button
            type="button"
            onClick={() => patchValidation({ creator_mode_enabled: false, respondent_mode_enabled: true })}
            className="text-xs text-mooove-cyan hover:underline"
          >
            Passer en mode Répondant
          </button>
        )}
      </div>

      {/* Interface selon le type */}
      {type === 'video' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-text-secondary mb-2">Lien YouTube ou Vimeo</label>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                patchValidation({ media_url: e.target.value || undefined });
              }}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden"
            />
            <p className="text-xs text-text-tertiary mt-1">
              Formats acceptés : youtu.be/ID · youtube.com/watch?v=ID · vimeo.com/ID
            </p>
          </div>

          {field.validation?.media_url && (
            <CreatorContent type={type} mediaUrl={field.validation.media_url} alignment="center" field={field} compact={false} globalStyle={globalStyle} />
          )}
        </div>
      )}

      {(type === 'image' || type === 'file') && (
        <div className="space-y-3">
          {field.validation?.media_url ? (
            <div className="space-y-3">
              <CreatorContent
                type={type}
                mediaUrl={field.validation.media_url}
                alignment={field.validation?.alignment ?? 'center'}
                field={field}
                compact={false}
                onSizeChange={(width, height) => {
                  patchValidation({
                    image_width: width,
                    image_height: height,
                    // Stocker les dimensions originales si pas encore définies
                    original_width: field?.validation?.original_width ?? field?.validation?.image_width ?? width,
                    original_height: field?.validation?.original_height ?? field?.validation?.image_height ?? height
                  });
                }}
                globalStyle={globalStyle}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-accent bg-accent/5 p-8 text-center transition hover:bg-accent/10 disabled:cursor-wait disabled:opacity-60"
            >
              <Upload className="h-8 w-8 text-accent" />
              <div>
                <p className="font-medium text-text-primary">
                  {uploading
                    ? `Envoi en cours… ${progress}%`
                    : type === 'image'
                      ? 'Cliquez pour ajouter une image'
                      : 'Cliquez pour ajouter un fichier'}
                </p>
                <p className="text-xs text-text-tertiary mt-1">
                  {type === 'image'
                    ? 'PNG, JPG, SVG, WebP · max 10 Mo'
                    : 'PDF, DOC, XLS, TXT, CSV · max 25 Mo'
                  }
                </p>
              </div>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={type === 'image' ? 'image/*' : '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv'}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Zone répondant agrandie après sélection */
function ExpandedRespondentZone({ field, type, labels, onChange }: {
  field: Field;
  type: 'image' | 'video' | 'file';
  labels: { creator: string; respondent: string };
  onChange?: (patch: Partial<Field>) => void;
}) {
  function patchValidation(patch: Partial<import('@/types').FieldValidation>) {
    if (!onChange) return;
    onChange({ validation: { ...field.validation, ...patch } });
  }

  const maxFileSize = field.validation?.max_file_size_mb ?? 10;
  const acceptTypes = field.validation?.accept?.join(', ') ?? getDefaultAcceptTypes(type);

  return (
    <div className="space-y-3">
      {/* Header avec mode actif */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{labels.respondent}</span>
          <span className="rounded-md bg-mooove-cyan px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
            Répondant
          </span>
        </div>
        <button
          type="button"
          onClick={() => patchValidation({ respondent_mode_enabled: false, creator_mode_enabled: true })}
          className="text-xs text-accent hover:underline"
        >
          Passer en mode Créateur
        </button>
      </div>

      {/* Zone de dépôt simulée */}
      <div className="w-full flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-mooove-cyan bg-mooove-cyan/5 p-8 text-center">
        <div className="h-8 w-8 flex items-center justify-center text-mooove-cyan">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <div>
          <p className="font-medium text-text-primary">
            {type === 'image' ? 'Les répondants pourront déposer une image' :
             type === 'video' ? 'Les répondants pourront déposer une vidéo' :
             'Les répondants pourront déposer un fichier'}
          </p>
          <p className="text-xs text-text-tertiary mt-1">
            Formats : {acceptTypes} · Max {maxFileSize} MB
          </p>
        </div>
      </div>

    </div>
  );
}


/** Composant ResizableImage avec poignées de redimensionnement */
function ResizableImage({
  src,
  alt,
  field,
  onSizeChange,
  alignment = 'center'
}: {
  src: string;
  alt: string;
  field?: Field;
  onSizeChange?: (width: number, height: number) => void;
  alignment?: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [, setResizeHandle] = useState<string>('');

  const customWidth = field?.validation?.image_width;
  const customHeight = field?.validation?.image_height;
  const positionX = field?.validation?.image_position_x ?? 0;
  const positionY = field?.validation?.image_position_y ?? 0;
  const ratioLocked = field?.validation?.ratio_locked ?? true;

  // Calculer les dimensions d'affichage
  const currentWidth = customWidth || (imgRef.current?.naturalWidth ?? 300);
  const currentHeight = customHeight || (imgRef.current?.naturalHeight ?? 200);
  const aspectRatio = currentWidth / currentHeight;

  const alignClass = alignment === 'left' ? 'justify-start' :
                    alignment === 'right' ? 'justify-end' : 'justify-center';

  const imageStyle: React.CSSProperties = {
    width: currentWidth + 'px',
    height: currentHeight + 'px',
    transform: `translate(${positionX}px, ${positionY}px)`
  };

  const handleMouseDown = (e: React.MouseEvent, handle: string) => {
    e.preventDefault();
    setIsResizing(true);
    setResizeHandle(handle);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = currentWidth;
    const startHeight = currentHeight;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;

      // Calculer les nouvelles dimensions selon la poignée
      switch (handle) {
        case 'nw': // Coin nord-ouest
          newWidth = startWidth - deltaX;
          newHeight = ratioLocked ? newWidth / aspectRatio : startHeight - deltaY;
          break;
        case 'ne': // Coin nord-est
          newWidth = startWidth + deltaX;
          newHeight = ratioLocked ? newWidth / aspectRatio : startHeight - deltaY;
          break;
        case 'sw': // Coin sud-ouest
          newWidth = startWidth - deltaX;
          newHeight = ratioLocked ? newWidth / aspectRatio : startHeight + deltaY;
          break;
        case 'se': // Coin sud-est
          newWidth = startWidth + deltaX;
          newHeight = ratioLocked ? newWidth / aspectRatio : startHeight + deltaY;
          break;
        case 'n': // Milieu nord
          if (!ratioLocked) {
            newHeight = startHeight - deltaY;
          }
          break;
        case 's': // Milieu sud
          if (!ratioLocked) {
            newHeight = startHeight + deltaY;
          }
          break;
        case 'w': // Milieu ouest
          newWidth = startWidth - deltaX;
          if (ratioLocked) {
            newHeight = newWidth / aspectRatio;
          }
          break;
        case 'e': // Milieu est
          newWidth = startWidth + deltaX;
          if (ratioLocked) {
            newHeight = newWidth / aspectRatio;
          }
          break;
      }

      // Contraintes de taille minimale/maximale
      newWidth = Math.max(50, Math.min(1200, newWidth));
      newHeight = Math.max(30, Math.min(800, newHeight));

      // Appliquer les nouvelles dimensions
      if (onSizeChange) {
        onSizeChange(Math.round(newWidth), Math.round(newHeight));
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeHandle('');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };


  const handleStyle = "absolute w-2 h-2 bg-blue-500 border border-white rounded-full shadow-xs hover:bg-blue-600 cursor-pointer";

  return (
    <div className={`flex ${alignClass}`}>
      <div
        className="relative inline-block group"
        style={{ minWidth: '50px', minHeight: '30px' }}
      >
        {/* Image */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          style={imageStyle}
          className={`rounded-md object-contain select-none ${isResizing ? 'cursor-grabbing' : 'cursor-default'}`}
          draggable={false}
        />

        {/* Poignées de redimensionnement - visibles au hover */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {/* Coins */}
          <div
            className={`${handleStyle} -top-1 -left-1 cursor-nw-resize`}
            onMouseDown={(e) => handleMouseDown(e, 'nw')}
          />
          <div
            className={`${handleStyle} -top-1 -right-1 cursor-ne-resize`}
            onMouseDown={(e) => handleMouseDown(e, 'ne')}
          />
          <div
            className={`${handleStyle} -bottom-1 -left-1 cursor-sw-resize`}
            onMouseDown={(e) => handleMouseDown(e, 'sw')}
          />
          <div
            className={`${handleStyle} -bottom-1 -right-1 cursor-se-resize`}
            onMouseDown={(e) => handleMouseDown(e, 'se')}
          />

          {/* Milieux des côtés */}
          <div
            className={`${handleStyle} -top-1 left-1/2 -translate-x-1/2 ${ratioLocked ? 'cursor-not-allowed opacity-50' : 'cursor-n-resize'}`}
            onMouseDown={(e) => !ratioLocked && handleMouseDown(e, 'n')}
          />
          <div
            className={`${handleStyle} -bottom-1 left-1/2 -translate-x-1/2 ${ratioLocked ? 'cursor-not-allowed opacity-50' : 'cursor-s-resize'}`}
            onMouseDown={(e) => !ratioLocked && handleMouseDown(e, 's')}
          />
          <div
            className={`${handleStyle} top-1/2 -left-1 -translate-y-1/2 cursor-w-resize`}
            onMouseDown={(e) => handleMouseDown(e, 'w')}
          />
          <div
            className={`${handleStyle} top-1/2 -right-1 -translate-y-1/2 cursor-e-resize`}
            onMouseDown={(e) => handleMouseDown(e, 'e')}
          />
        </div>

        {/* Indicateur de verrouillage du ratio */}
        {ratioLocked && (
          <div className="absolute -top-6 left-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="flex items-center gap-1 text-xs text-blue-600 font-medium bg-white/90 backdrop-blur px-2 py-1 rounded-sm shadow-xs">
              🔒 Ratio verrouillé
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Affichage du contenu créateur */
function CreatorContent({ type, mediaUrl, alignment, field, compact = false, preview = false, globalStyle, onSizeChange }: {
  type: 'image' | 'video' | 'file';
  mediaUrl: string;
  alignment: string;
  field?: Field;
  compact?: boolean;
  preview?: boolean;
  globalStyle?: any;
  onSizeChange?: (width: number, height: number) => void;
}) {
  const alignClass = alignment === 'left' ? 'justify-start' :
                    alignment === 'right' ? 'justify-end' : 'justify-center';

  const _sizeClass = compact ? 'max-h-24' : 'max-h-80';

  // Appliquer le même style que les questions normales (comme dans FieldCard.tsx)
  const SIZE_CLASSES: Record<string, string> = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
    xl: 'text-2xl'
  };

  const FONT_CLASSES: Record<string, string> = {
    sans: 'font-sans',
    display: 'font-sans',
    serif: 'font-serif',
    mono: 'font-mono'
  };

  const WEIGHT_CLASSES: Record<string, string> = {
    normal: 'font-normal',
    medium: 'font-medium',
    bold: 'font-bold'
  };

  // Style uniforme pour les titres (même logique que FieldCard.tsx)
  const resolvedStyle = { ...(globalStyle ?? {}), ...(field?.style ?? {}) };
  const labelSize = SIZE_CLASSES[resolvedStyle.label_size ?? 'lg'];
  const labelFont = FONT_CLASSES[resolvedStyle.font_family ?? 'sans'];
  // Utiliser 'medium' comme poids par défaut pour correspondre aux questions normales
  const labelWeight = WEIGHT_CLASSES[resolvedStyle.label_weight ?? 'medium'];
  const _labelClass = cn(labelSize, labelFont, labelWeight, resolvedStyle.label_italic && 'italic');
  const _labelInlineStyle: React.CSSProperties = {
    color: resolvedStyle.label_color,
    textAlign: resolvedStyle.label_align
  };

  if (type === 'image') {
    const showTitle = field?.validation?.show_title ?? false;
    const title = field?.label?.fr;

    // En mode compact ou preview, utiliser une image simple
    if (compact || preview) {
      const customWidth = field?.validation?.image_width;
      const customHeight = field?.validation?.image_height;
      const imageStyle: React.CSSProperties = {};
      if (customWidth) imageStyle.width = customWidth + 'px';
      if (customHeight) imageStyle.height = customHeight + 'px';

      // En mode compact : max-h-24, en mode preview : max-h-80 (taille normale)
      const maxHeightClass = compact ? 'max-h-24' : 'max-h-80';

      const imageElement = (
        <div className={`flex ${alignClass}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mediaUrl}
            alt={title || 'Image'}
            style={imageStyle}
            className={customWidth || customHeight
              ? 'rounded-md object-contain'
              : `max-w-full rounded-md object-contain ${maxHeightClass}`
            }
          />
        </div>
      );

      return imageElement;
    }

    // En mode builder normal, utiliser ResizableImage avec poignées
    const imageElement = (
      <ResizableImage
        src={mediaUrl}
        alt={title || 'Image'}
        field={field}
        alignment={alignment}
        onSizeChange={onSizeChange}
      />
    );

    if (showTitle && title && preview) {
      return (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
          {imageElement}
        </div>
      );
    }

    return imageElement;
  }

  if (type === 'video') {
    const parsed = parseVideoEmbed(mediaUrl);
    const _showTitle = field?.validation?.show_title ?? false;
    const title = field?.label?.fr;

    if (!parsed) {
      return (
        <div className="rounded-md border border-dashed border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          URL non reconnue
        </div>
      );
    }

    // En mode compact : max-h-24, en mode preview ou normal : pas de limitation de hauteur
    const heightClass = compact ? 'max-h-24' : '';

    const videoElement = (
      <div className={`aspect-video w-full overflow-hidden rounded-md border border-border bg-black ${heightClass}`}>
        <iframe
          src={parsed.embedUrl}
          title={title || 'Vidéo'}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );

    return videoElement;
  }

  if (type === 'file') {
    const _showTitle = field?.validation?.show_title ?? false;
    const _title = field?.label?.fr;

    // Extraire le nom du fichier avec la fonction helper
    const fileName = extractFileName(mediaUrl, 'Fichier téléchargé');
    const fileExt = fileName.split('.').pop()?.toLowerCase() || '';

    // Détection du type de fichier et configuration de l'apparence
    const getFileConfig = (extension: string) => {
      switch (extension) {
        case 'pdf':
          return {
            icon: '🗎',
            color: 'text-red-600',
            bgColor: 'bg-red-50 border-red-200',
            type: 'PDF',
            iconColor: '#DC2626'
          };
        case 'doc':
        case 'docx':
          return {
            icon: '🗎',
            color: 'text-blue-600',
            bgColor: 'bg-blue-50 border-blue-200',
            type: 'DOCX',
            iconColor: '#2563EB'
          };
        case 'xls':
        case 'xlsx':
          return {
            icon: '🗎',
            color: 'text-green-600',
            bgColor: 'bg-green-50 border-green-200',
            type: 'XLSX',
            iconColor: '#059669'
          };
        case 'ppt':
        case 'pptx':
          return {
            icon: '🗎',
            color: 'text-orange-600',
            bgColor: 'bg-orange-50 border-orange-200',
            type: 'PPTX',
            iconColor: '#EA580C'
          };
        case 'zip':
        case 'rar':
        case '7z':
          return {
            icon: '🗀',
            color: 'text-purple-600',
            bgColor: 'bg-purple-50 border-purple-200',
            type: 'ZIP',
            iconColor: '#9333EA'
          };
        case 'txt':
          return {
            icon: '🗎',
            color: 'text-text-secondary',
            bgColor: 'bg-bg-elevated border-border',
            type: 'TXT',
            iconColor: '#6B7280'
          };
        case 'csv':
          return {
            icon: '🗎',
            color: 'text-green-600',
            bgColor: 'bg-green-50 border-green-200',
            type: 'CSV',
            iconColor: '#059669'
          };
        default:
          return {
            icon: '🗎',
            color: 'text-text-secondary',
            bgColor: 'bg-bg-elevated border-border',
            type: 'FILE',
            iconColor: '#6B7280'
          };
      }
    };

    const fileConfig = getFileConfig(fileExt);

    const fileElement = (
      <div className={`relative rounded-xl border-2 p-4 transition-all hover:shadow-md ${fileConfig.bgColor} w-full`}>
        {/* Coin avec type de fichier */}
        <div className="absolute -top-1 -right-1 rounded-md bg-gray-600 px-2 py-0.5 text-xs font-semibold text-white shadow-xs">
          {fileConfig.type}
        </div>

        {/* Contenu principal */}
        <div className="flex items-start gap-3 pt-2">
          {/* Icône du fichier */}
          <div className="shrink-0">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="6" y="4" width="16" height="22" rx="2" fill={fileConfig.iconColor}/>
              <path d="M18 4v6h4l-4-6z" fill="white" fillOpacity="0.8"/>
              <rect x="9" y="14" width="10" height="1" fill="white" fillOpacity="0.7"/>
              <rect x="9" y="17" width="8" height="1" fill="white" fillOpacity="0.7"/>
              <rect x="9" y="20" width="6" height="1" fill="white" fillOpacity="0.7"/>
            </svg>
          </div>

          {/* Informations du fichier */}
          <div className="flex-1 min-w-0">
            <h4 className={`font-medium text-sm leading-tight mb-1 ${fileConfig.color} truncate`}>
              {fileName.replace(/\.[^/.]+$/, "")}
            </h4>
            <p className="text-xs text-text-secondary uppercase tracking-wide">
              {fileConfig.type} • {mediaUrl.startsWith('data:') ? 'Téléchargé' : 'URL'}
            </p>
          </div>

          {/* Bouton de téléchargement */}
          {mediaUrl.startsWith('data:') && (
            <button
              type="button"
              onClick={() => {
                const link = document.createElement('a');
                link.href = mediaUrl;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              className="shrink-0 rounded-full p-2 text-text-tertiary hover:bg-white hover:text-text-secondary transition-all"
              title="Télécharger le fichier"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    );

    return fileElement;
  }

  return null;
}


function MatrixField({
  field,
  preview,
  value,
  onChange
}: {
  field: Field;
  preview: boolean;
  value?: Record<string, string | string[]>;
  onChange?: (val: Record<string, string | string[]>) => void;
}) {
  const rows = field.rows ?? [];
  const cols = field.options ?? [];
  const mode = field.validation?.matrix_mode ?? 'single';
  const inputType = mode === 'multiple' ? 'checkbox' : 'radio';

  const [localValue, setLocalValue] = useState<Record<string, string | string[]>>({});
  const currentValue = value !== undefined ? value : localValue;

  const handleChange = (rowId: string, colId: string, checked: boolean) => {
    const nextValue = { ...currentValue };
    if (mode === 'single') {
      if (checked) {
        nextValue[rowId] = colId;
      } else {
        delete nextValue[rowId];
      }
    } else {
      const currentList = Array.isArray(nextValue[rowId]) ? (nextValue[rowId] as string[]) : [];
      if (checked) {
        nextValue[rowId] = [...currentList, colId];
      } else {
        nextValue[rowId] = currentList.filter((id) => id !== colId);
      }
    }

    if (onChange) {
      onChange(nextValue);
    } else {
      setLocalValue(nextValue);
    }
  };

  if (rows.length === 0 || cols.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-strong bg-bg-base px-3 py-2 text-xs text-text-tertiary">
        Configurez les lignes et colonnes dans le panneau de droite
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-bg-base">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-elevated/40 text-text-secondary">
            <th className="px-3 py-2 text-left text-xs font-medium" />
            {cols.map((col) => (
              <th key={col.id} className="px-3 py-2 text-center text-xs font-medium">
                {col.label.fr || '—'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rIdx) => (
            <tr
              key={row.id}
              className={rIdx < rows.length - 1 ? 'border-b border-dashed border-border' : ''}
            >
              <td className="wrap-break-word px-3 py-2 text-text-primary">
                {row.label.fr || `Ligne ${rIdx + 1}`}
              </td>
              {cols.map((col) => {
                const isChecked = mode === 'single'
                  ? currentValue[row.id] === col.id
                  : Array.isArray(currentValue[row.id]) && (currentValue[row.id] as string[]).includes(col.id);

                return (
                  <td key={col.id} className="px-3 py-2 text-center">
                    <input
                      type={inputType}
                      name={mode === 'single' ? `${field.id}-${row.id}` : undefined}
                      disabled={preview}
                      checked={isChecked || false}
                      onChange={(e) => handleChange(row.id, col.id, e.target.checked)}
                      className={`h-4 w-4 ${inputType === 'checkbox' ? 'rounded-sm' : ''}`}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Composant pour champs texte court avec compteur de caractères */
function ShortTextWithCounter({
  field,
  controlAttrs,
  placeholder,
  required,
  preview,
  onChange,
  value,
  onValueChange
}: {
  field: Field;
  controlAttrs?: ControlAttrs;
  placeholder: string;
  required: boolean;
  preview: boolean;
  onChange?: (patch: Partial<Field>) => void;
  value?: string;
  onValueChange?: (val: string) => void;
}) {
  const [localValue, setLocalValue] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('none');
  const [touched, setTouched] = useState(false);
  const responseType = field.validation?.response_type ?? 'text';
  const currentValue = value !== undefined ? value : localValue;
  const handleValueChange = (val: string) => {
    if (onValueChange) onValueChange(val);
    else setLocalValue(val);
  };

  // Pour les champs texte
  if (responseType === 'text') {
    const maxLength = field.validation?.max ?? LIMITS.SHORT_TEXT_MAX_CHARS;
    const currentLength = currentValue.length;
    const isNearLimit = currentLength > maxLength * 0.8;
    const isAtLimit = currentLength >= maxLength;

    if (onChange) {
      return (
        <input
          type="text"
          value={field.placeholder?.fr ?? ''}
          onChange={(e) => {
            const current = field.placeholder ?? {};
            onChange({ placeholder: { ...current, fr: e.target.value } });
          }}
          placeholder={placeholder || 'Votre réponse'}
          className="w-full rounded-md border border-dashed border-border-strong bg-transparent px-3 py-2 text-sm text-text-tertiary placeholder:text-text-tertiary/40 focus:border-accent focus:bg-bg-elevated/50 focus:outline-hidden"
        />
      );
    }

    return (
      <div className="space-y-1.5">
        <AutoTextarea
          {...controlAttrs}
          name={field.id}
          value={currentValue}
          onChange={(e) => handleValueChange(e.target.value)}
          minRows={1}
          required={required && !preview}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={preview}
          className={cn(
            'w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden wrap-break-word',
            preview && 'disabled:cursor-default disabled:opacity-100',
            isAtLimit && !preview && 'border-orange-400 focus:border-orange-400'
          )}
          style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
        />

        {!preview && (
          <div className="flex justify-between text-xs">
            <span className="text-text-tertiary">
              {currentLength}/{maxLength} caractères
            </span>
            {isNearLimit && (
              <span className={cn(
                'font-medium',
                isAtLimit ? 'text-danger' : 'text-orange-600'
              )}>
                {isAtLimit ? 'Limite atteinte' : 'Proche de la limite'}
              </span>
            )}
          </div>
        )}

        {preview && (
          <p className="text-xs text-text-tertiary">
            Maximum {maxLength} caractères
          </p>
        )}
      </div>
    );
  }

  // Pour les champs numériques (entier ou décimal)
  const min = field.validation?.min;
  const max = field.validation?.max;
  const unit = field.validation?.unit ?? 'none';
  const userCanChooseUnit = field.validation?.user_can_choose_unit ?? false;
  const maxDecimals = field.validation?.max_decimals ?? 2;

  // Validation de la plage numérique
  let rangeError: string | null = null;
  if (touched && currentValue && !preview) {
    const numValue = parseFloat(currentValue);
    if (!isNaN(numValue)) {
      if (responseType === 'integer' && !Number.isInteger(numValue)) {
        rangeError = 'Veuillez saisir un nombre entier.';
      } else if (min !== undefined && numValue < min) {
        rangeError = max !== undefined
          ? `Choisir entre ${min} et ${max}.`
          : `Minimum ${min}.`;
      } else if (max !== undefined && numValue > max) {
        rangeError = min !== undefined
          ? `Choisir entre ${min} et ${max}.`
          : `Maximum ${max}.`;
      }
    }
  }

  // Génération du placeholder dynamique
  let dynamicPlaceholder = '';
  if (responseType === 'integer') {
    if (min !== undefined && max !== undefined) {
      dynamicPlaceholder = `Nombre entier de ${min} à ${max}`;
    } else if (min !== undefined) {
      dynamicPlaceholder = `Nombre entier (min. ${min})`;
    } else if (max !== undefined) {
      dynamicPlaceholder = `Nombre entier (max. ${max})`;
    } else {
      dynamicPlaceholder = 'Nombre entier';
    }
  } else if (responseType === 'decimal') {
    if (min !== undefined && max !== undefined) {
      dynamicPlaceholder = `Nombre de ${min} à ${max}`;
    } else if (min !== undefined) {
      dynamicPlaceholder = `Nombre (min. ${min})`;
    } else if (max !== undefined) {
      dynamicPlaceholder = `Nombre (max. ${max})`;
    } else {
      dynamicPlaceholder = 'Nombre décimal';
    }
  }

  // Pour les champs numériques, toujours utiliser le placeholder dynamique
  const finalPlaceholder = dynamicPlaceholder;

  // Mappage des unités
  const unitLabels = {
    none: '',
    euro: '€',
    dollar: '$',
    pound: '£',
    rupee: 'Rs',
    mur: 'MUR',
    kg: 'kg',
    g: 'g',
    lb: 'lb',
    cm: 'cm',
    m: 'm',
    ft: 'ft',
    in: 'in',
    miles: 'mi',
    arpent: 'arp',
    percent: '%'
  };

  const unitOptions = [
    { value: 'none', label: 'Choisir' },
    { value: 'euro', label: '€ Euro' },
    { value: 'dollar', label: '$ Dollar' },
    { value: 'pound', label: '£ Livre' },
    { value: 'rupee', label: 'Rs Roupie' },
    { value: 'mur', label: 'MUR Roupie mauricienne' },
    { value: 'kg', label: 'kg' },
    { value: 'g', label: 'g' },
    { value: 'lb', label: 'lb (livre)' },
    { value: 'cm', label: 'cm' },
    { value: 'm', label: 'm' },
    { value: 'ft', label: 'ft (pied)' },
    { value: 'in', label: 'in (pouce)' },
    { value: 'miles', label: 'miles' },
    { value: 'arpent', label: 'arpent' },
    { value: 'percent', label: '%' }
  ];

  // Validation de l'unité
  const unitRequired = userCanChooseUnit && !preview;
  const unitError = unitRequired && touched && selectedUnit === 'none';

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <input
          {...controlAttrs}
          name={field.id}
          type="number"
          value={currentValue}
          onChange={(e) => handleValueChange(e.target.value)}
          onBlur={() => setTouched(true)}
          required={required && !preview}
          min={min}
          max={max}
          step={responseType === 'decimal' ? Math.pow(0.1, maxDecimals) : 1}
          placeholder={finalPlaceholder}
          disabled={preview}
          className={cn(
            'flex-1 rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden',
            preview && 'disabled:cursor-default disabled:opacity-100',
            rangeError ? 'border-danger focus:border-danger' : ''
          )}
        />

        {/* Affichage de l'unité */}
        {unit !== 'none' && !userCanChooseUnit && (
          <div className="flex shrink-0 items-center rounded-md bg-bg-elevated px-3 py-2 text-sm text-text-secondary border border-border">
            {unitLabels[unit as keyof typeof unitLabels]}
          </div>
        )}

        {/* Sélecteur d'unité pour l'utilisateur */}
        {userCanChooseUnit && !preview && (
          <select
            value={selectedUnit}
            onChange={(e) => {
              setSelectedUnit(e.target.value);
              setTouched(true);
            }}
            onBlur={() => setTouched(true)}
            required
            className={cn(
              "shrink-0 rounded-md border bg-bg-base px-3 py-2 text-sm text-text-primary focus:outline-hidden",
              unitError
                ? "border-red-500 focus:border-red-500"
                : "border-border-strong focus:border-accent"
            )}
          >
            {unitOptions.map((option) => (
              <option key={option.value} value={option.value} disabled={option.value === 'none'}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Message d'erreur pour l'unité */}
      {unitError && (
        <p className="text-xs text-red-500">
          Veuillez choisir une unité
        </p>
      )}

      {/* Info validation pour preview */}
      {preview && (min !== undefined || max !== undefined) && (
        <p className="text-xs text-text-tertiary">
          {min !== undefined && max !== undefined ? `Entre ${min} et ${max}` :
           min !== undefined ? `Minimum ${min}` :
           `Maximum ${max}`}
          {unit !== 'none' && ` (unité: ${unitLabels[unit as keyof typeof unitLabels]})`}
        </p>
      )}

      {/* Message d'erreur de validation de plage */}
      {rangeError && <p className="text-xs text-danger">{rangeError}</p>}
    </div>
  );
}

/** Composant pour champs texte long avec compteur de caractères */
function LongTextWithCounter({
  field,
  controlAttrs,
  placeholder,
  required,
  preview,
  onChange,
  value,
  onValueChange
}: {
  field: Field;
  controlAttrs?: ControlAttrs;
  placeholder: string;
  required: boolean;
  preview: boolean;
  onChange?: (patch: Partial<Field>) => void;
  value?: string;
  onValueChange?: (val: string) => void;
}) {
  const [localValue, setLocalValue] = useState('');
  const currentValue = value !== undefined ? value : localValue;
  const handleValueChange = (val: string) => {
    if (onValueChange) onValueChange(val);
    else setLocalValue(val);
  };
  const maxLength = field.validation?.max ?? LIMITS.LONG_TEXT_MAX_CHARS;
  const currentLength = currentValue.length;
  const isNearLimit = currentLength > maxLength * 0.8;
  const isAtLimit = currentLength >= maxLength;

  if (onChange) {
    return (
      <textarea
        rows={3}
        value={field.placeholder?.fr ?? ''}
        onChange={(e) => {
          const current = field.placeholder ?? {};
          onChange({ placeholder: { ...current, fr: e.target.value } });
        }}
        placeholder={placeholder || 'Votre réponse…'}
        className="w-full rounded-md border border-dashed border-border-strong bg-transparent px-3 py-2 text-sm text-text-tertiary placeholder:text-text-tertiary/40 focus:border-accent focus:bg-bg-elevated/50 focus:outline-hidden resize-y"
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <AutoTextarea
        {...controlAttrs}
        name={field.id}
        value={currentValue}
        onChange={(e) => handleValueChange(e.target.value)}
        minRows={3}
        required={required && !preview}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={preview}
        className={cn(
          'w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden wrap-break-word',
          preview && 'disabled:cursor-default disabled:opacity-100',
          isAtLimit && !preview && 'border-orange-400 focus:border-orange-400'
        )}
        style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
      />

      {/* Compteur pour répondants seulement */}
      {!preview && (
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">
            {currentLength}/{maxLength} caractères
          </span>
          {isNearLimit && (
            <span className={cn(
              'font-medium',
              isAtLimit ? 'text-danger' : 'text-orange-600'
            )}>
              {isAtLimit ? 'Limite atteinte' : 'Proche de la limite'}
            </span>
          )}
        </div>
      )}

      {/* Info limite pour mode preview */}
      {preview && (
        <p className="text-xs text-text-tertiary">
          Maximum {maxLength} caractères
        </p>
      )}
    </div>
  );
}

/** Composant pour champ number avec validation de plage */
function NumberInputWithValidation({
  field,
  controlAttrs,
  placeholder,
  required,
  preview,
  baseInput,
  onChange,
  value,
  onValueChange
}: {
  field: Field;
  controlAttrs?: ControlAttrs;
  placeholder: string;
  required: boolean;
  preview: boolean;
  baseInput: string;
  onChange?: (patch: Partial<Field>) => void;
  value?: string;
  onValueChange?: (val: string) => void;
}) {
  const [localValue, setLocalValue] = useState('');
  const [touched, setTouched] = useState(false);
  const currentValue = value !== undefined ? value : localValue;
  const handleValueChange = (val: string) => {
    if (onValueChange) onValueChange(val);
    else setLocalValue(val);
  };

  if (onChange) {
    return (
      <input
        type="text"
        value={field.placeholder?.fr ?? ''}
        onChange={(e) => {
          const current = field.placeholder ?? {};
          onChange({ placeholder: { ...current, fr: e.target.value } });
        }}
        placeholder={placeholder || '4'}
        className="w-full rounded-md border border-dashed border-border-strong bg-transparent px-3 py-2 text-sm text-text-tertiary placeholder:text-text-tertiary/40 focus:border-accent focus:bg-bg-elevated/50 focus:outline-hidden"
      />
    );
  }
  const min = field.validation?.min;
  const max = field.validation?.max;

  // Mappage des unités
  const unitLabels = {
    none: '',
    euro: '€',
    dollar: '$',
    pound: '£',
    rupee: 'Rs',
    mur: 'MUR',
    kg: 'kg',
    g: 'g',
    lb: 'lb',
    cm: 'cm',
    m: 'm',
    ft: 'ft',
    in: 'in',
    miles: 'mi',
    arpent: 'arp',
    percent: '%'
  };

  // Validation de la plage numérique
  let rangeError: string | null = null;
  if (touched && currentValue && !preview) {
    const numValue = parseFloat(currentValue);
    if (!isNaN(numValue)) {
      if (min !== undefined && numValue < min) {
        rangeError = max !== undefined
          ? `Choisir entre ${min} et ${max}.`
          : `Minimum ${min}.`;
      } else if (max !== undefined && numValue > max) {
        rangeError = min !== undefined
          ? `Choisir entre ${min} et ${max}.`
          : `Maximum ${max}.`;
      }
    }
  }

  return (
    <div className="space-y-1">
      <input
        {...controlAttrs}
        type="number"
        name={field.id}
        value={currentValue}
        onChange={(e) => handleValueChange(e.target.value)}
        onBlur={() => setTouched(true)}
        required={required && !preview}
        className={cn(
          baseInput,
          rangeError ? 'border-danger focus:border-danger' : ''
        )}
        placeholder={placeholder}
        min={min}
        max={max}
        disabled={preview}
      />

      {/* Info validation pour preview */}
      {preview && (min !== undefined || max !== undefined) && (
        <p className="text-xs text-text-tertiary">
          {min !== undefined && max !== undefined ? `Entre ${min} et ${max}` :
           min !== undefined ? `Minimum ${min}` :
           `Maximum ${max}`}
          {field.validation?.unit !== 'none' && field.validation?.unit && ` (unité: ${unitLabels[field.validation.unit as keyof typeof unitLabels]})`}
        </p>
      )}

      {/* Message d'erreur de validation de plage */}
      {rangeError && <p className="text-xs text-danger">{rangeError}</p>}
    </div>
  );
}
