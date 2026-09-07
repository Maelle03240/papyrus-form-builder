'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, ExternalLink, EyeOff, Plus, Trash2 } from 'lucide-react';

import { AutoTextarea } from '@/components/ui/AutoTextarea';
import { COUNTRIES } from '@/lib/constants/countries';
import { calcFieldValue } from '@/lib/calculated';
import { useAttachmentUpload } from '@/lib/hooks/useAttachmentUpload';
import { useFormSlug } from '@/lib/hooks/useFormSlug';
import { DEFAULT_CURRENCY } from '@/lib/submission-format';
import { formatMoney } from '@/lib/pricing';
import type { RendererPricing } from './OptionPricing';
import { cn } from '@/lib/utils';
import type { Field, SubField } from '@/types';

/**
 * Les dix types de champ ajoutés en phase 2, pour la parité avec
 * mooove-invoice.
 *
 * Ils vivent dans un fichier à part plutôt qu'au bas de `FieldRenderer`, qui
 * passe déjà deux mille six cents lignes. Chacun est rendu à la fois dans le
 * canevas du constructeur et dans le formulaire public — comme tous les autres
 * champs de Papyrus, il n'y a qu'un seul rendu.
 */

const BASE_INPUT =
  'w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden disabled:cursor-default disabled:opacity-100';

/**
 * `interactive` distingue le formulaire public du canevas du constructeur.
 *
 * Ce n'est pas `preview` qui le dit : le canevas et la vue publique passent tous
 * deux `preview={false}`, et ce qui les sépare réellement est la présence d'un
 * `onValueChange`. Confondre les deux ferait déposer une signature sur R2 à
 * chaque trait tracé par l'auteur dans son propre éditeur.
 */
interface FieldProps {
  field: Field;
  interactive?: boolean;
  value?: unknown;
  onValueChange?: (value: unknown) => void;
}

// ============================================================================
// Montant
// ============================================================================

export function CurrencyField({
  field,
  placeholder,
  interactive,
  value,
  onValueChange,
  inputId
}: FieldProps & { placeholder?: string; inputId?: string }) {
  const code = field.validation?.currency_code || DEFAULT_CURRENCY;
  const after = field.validation?.currency_position === 'after';

  const symbol = (
    <span
      className={cn(
        'flex shrink-0 select-none items-center text-sm font-medium text-text-tertiary',
        after ? 'pl-1.5 pr-3' : 'pl-3 pr-1.5'
      )}
    >
      {code}
    </span>
  );

  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-border-strong bg-bg-base focus-within:border-accent">
      {!after && symbol}
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        step="0.01"
        min={field.validation?.min}
        max={field.validation?.max}
        value={interactive ? String(value ?? '') : ''}
        onChange={(event) => onValueChange?.(event.target.value)}
        disabled={!interactive}
        placeholder={placeholder || '0.00'}
        className={cn(
          'min-w-0 flex-1 border-0 bg-transparent py-2 text-sm text-text-primary tabular-nums',
          'placeholder:text-text-tertiary focus:outline-hidden disabled:cursor-default disabled:opacity-100',
          after ? 'pl-0 pr-0' : 'pl-0 pr-3'
        )}
      />
      {after && symbol}
    </div>
  );
}

// ============================================================================
// Pays
// ============================================================================

export function CountryField({
  field,
  interactive,
  value,
  onValueChange,
  inputId
}: FieldProps & { inputId?: string }) {
  const selected = String(value ?? field.validation?.default_country_code ?? '');

  return (
    <select
      id={inputId}
      value={interactive ? selected : ''}
      onChange={(event) => onValueChange?.(event.target.value)}
      disabled={!interactive}
      className={cn(BASE_INPUT, 'appearance-none')}
    >
      <option value="">Sélectionnez un pays…</option>
      {/* Sans le drapeau : les indicatifs régionaux Unicode n'ont pas de police
          sur Windows, où ils se rendent en deux minuscules capitales — « мu
          Maurice » plutôt que « 🇲🇺 Maurice ». */}
      {COUNTRIES.map((country) => (
        <option key={country.code} value={country.code}>
          {country.name}
        </option>
      ))}
    </select>
  );
}

// ============================================================================
// Oui / Non
// ============================================================================

export function YesNoField({
  field,
  interactive,
  value,
  onValueChange,
  labelledBy
}: FieldProps & { labelledBy?: string }) {
  const options = [
    { value: 'yes', label: field.validation?.yes_label || 'Oui' },
    { value: 'no', label: field.validation?.no_label || 'Non' }
  ];

  return (
    <div className="flex gap-2" role="group" aria-labelledby={labelledBy}>
      {options.map((option) => {
        const active = interactive === true && value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={!interactive}
            onClick={() => onValueChange?.(active ? '' : option.value)}
            className={cn(
              'flex-1 rounded-md border px-4 py-2 text-sm font-medium transition',
              active
                ? 'border-transparent bg-accent text-white'
                : 'border-border-strong bg-bg-base text-text-primary hover:border-accent',
              !interactive && 'cursor-default'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Signature
// ============================================================================

/**
 * Signature tracée à la main.
 *
 * mooove-invoice se contentait d'une case « je certifie » : une case cochée
 * n'est pas une signature, et personne ne la reconnaîtrait comme telle sur un
 * bon de commande. Le tracé part sur R2 comme n'importe quel média, et c'est son
 * URL qui est enregistrée — jamais une data URL en base, la règle de stockage
 * Mooove vaut ici comme ailleurs.
 */
export function SignatureField({ field, interactive, value, onValueChange }: FieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const dirtyRef = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);
  const formSlug = useFormSlug();
  // Une signature est déposée par le répondant, pas par l'auteur : le contexte
  // `response` est celui que la route de dépôt autorise sans session.
  const { upload, uploading } = useAttachmentUpload({ context: 'response', formSlug: formSlug ?? undefined });

  const signedUrl = typeof value === 'string' && value.startsWith('http') ? value : null;
  const strokeWidth = field.validation?.signature_stroke_width ?? 2;

  // Le canevas est dimensionné en pixels physiques : sans cela, le trait est
  // flou sur tout écran à densité élevée — c'est-à-dire sur tous les téléphones,
  // là où l'on signe réellement avec le doigt.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#052139';
    context.lineWidth = strokeWidth;
  }, [strokeWidth]);

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const { x, y } = pointAt(event);
    context.beginPath();
    context.moveTo(x, y);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const { x, y } = pointAt(event);
    context.lineTo(x, y);
    context.stroke();
    dirtyRef.current = true;
    if (!hasStroke) setHasStroke(true);
  };

  const finish = useCallback(async () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (!dirtyRef.current) return;
    dirtyRef.current = false;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Le dépôt attend la fin du tracé, pas chaque mouvement : signer prend une
    // seconde et produirait autrement une centaine d'envois.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;

    const file = new File([blob], `signature-${Date.now()}.png`, { type: 'image/png' });
    const url = await upload(file);
    if (url) onValueChange?.(url);
  }, [onValueChange, upload]);

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    dirtyRef.current = false;
    setHasStroke(false);
    onValueChange?.('');
  };

  if (!interactive) {
    return (
      <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-border-strong bg-bg-base text-xs text-text-tertiary">
        Zone de signature
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={() => void finish()}
          onPointerLeave={() => void finish()}
          className="h-28 w-full touch-none rounded-md border border-border-strong bg-white"
        />
        {!hasStroke && !signedUrl && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-tertiary">
            Signez ici
          </span>
        )}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-text-tertiary">
          {uploading ? 'Enregistrement…' : signedUrl ? 'Signature enregistrée' : ' '}
        </span>
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary"
        >
          <Eraser className="h-3.5 w-3.5" />
          Effacer
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Bloc répétable
// ============================================================================

type RepeaterRow = Record<string, unknown>;

export function RepeaterField({
  field,
  interactive,
  mobile,
  value,
  onValueChange,
  pricing
}: FieldProps & { mobile?: boolean; pricing?: RendererPricing }) {
  const config = field.repeater;
  const subfields = config?.fields ?? [];
  const min = Math.max(1, config?.min ?? 1);
  const max = Math.max(min, config?.max ?? 10);
  const itemLabel = config?.item_label?.fr || 'Ligne';

  const rows: RepeaterRow[] = Array.isArray(value) && value.length > 0 ? (value as RepeaterRow[]) : [{}];

  if (subfields.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-strong bg-bg-base px-3 py-2 text-xs text-text-tertiary">
        Aucune sous-question — ajoutez-en dans le panneau de droite
      </div>
    );
  }

  const setCell = (rowIndex: number, subfieldId: string, cell: unknown) => {
    onValueChange?.(
      rows.map((row, index) => (index === rowIndex ? { ...row, [subfieldId]: cell } : row))
    );
  };

  const add = () => {
    if (rows.length >= max) return;
    onValueChange?.([...rows, {}]);
  };

  const remove = (rowIndex: number) => {
    const next = rows.filter((_, index) => index !== rowIndex);
    onValueChange?.(next.length >= min ? next : [{}]);
  };

  return (
    <div className="space-y-2">
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="rounded-lg border border-border bg-bg-elevated p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {itemLabel} {rowIndex + 1}
            </span>
            {interactive && rows.length > min && (
              <button
                type="button"
                onClick={() => remove(rowIndex)}
                aria-label={`Supprimer ${itemLabel.toLowerCase()} ${rowIndex + 1}`}
                className="rounded-md p-1 text-text-tertiary transition hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className={cn('grid gap-3', mobile ? 'grid-cols-1' : 'sm:grid-cols-2')}>
            {subfields.map((subfield) => (
              <RepeaterCell
                key={subfield.id}
                subfield={subfield}
                // Chaque ligne porte ses propres identifiants : sans cela,
                // toutes les lignes partageraient le même `id`, et cliquer sur
                // le libellé de la troisième ligne placerait le curseur dans la
                // première.
                domId={`${field.id}-${rowIndex}-${subfield.id}`}
                pricing={pricing}
                interactive={interactive}
                value={row[subfield.id]}
                onChange={(cell) => setCell(rowIndex, subfield.id, cell)}
              />
            ))}
          </div>
        </div>
      ))}

      {interactive && rows.length < max && (
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/10"
        >
          <Plus className="h-4 w-4" />
          Ajouter {itemLabel.toLowerCase()}
        </button>
      )}

      <p className="text-xs text-text-tertiary">
        {min === max
          ? `${max} ${itemLabel.toLowerCase()}${max > 1 ? 's' : ''}.`
          : `De ${min} à ${max} ${itemLabel.toLowerCase()}${max > 1 ? 's' : ''}.`}
      </p>
    </div>
  );
}

/**
 * Une cellule de bloc répétable.
 *
 * Le rendu est délibérément autonome plutôt que délégué à `FieldRenderer` : un
 * sous-champ est un `SubField`, sans `section_id` ni `field_order`, et le faire
 * passer pour un `Field` complet ouvrirait la porte à un répéteur dans un
 * répéteur — donc à une récursion infinie au premier ajout de ligne.
 * `REPEATER_SUBFIELD_TYPES` ferme la liste des types autorisés ici.
 */
function RepeaterCell({
  subfield,
  domId,
  pricing,
  interactive,
  value,
  onChange
}: {
  subfield: SubField;
  /** Identifiant unique de cette cellule — lie le libellé à sa saisie. */
  domId: string;
  pricing?: RendererPricing;
  interactive?: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const labelId = `${domId}-label`;
  // Un groupe de boutons ou de cases n'est pas une saisie unique : `htmlFor` n'y
  // désignerait rien. Ces cas-là s'annoncent par `aria-labelledby`.
  const isGroup = subfield.type === 'yesno' || subfield.type === 'multiple_choice';

  const label = (
    <label
      id={labelId}
      htmlFor={isGroup ? undefined : domId}
      className="mb-1 block text-xs font-medium text-text-secondary"
    >
      {subfield.label?.fr || 'Sous-question'}
      {subfield.required && <span className="ml-0.5 text-danger">*</span>}
    </label>
  );

  const text = interactive ? String(value ?? '') : '';
  const common = {
    id: domId,
    disabled: !interactive,
    placeholder: subfield.placeholder?.fr ?? '',
    className: BASE_INPUT
  };

  let input: React.ReactNode;

  switch (subfield.type) {
    case 'long_text':
      input = (
        <AutoTextarea
          value={text}
          onChange={(event) => onChange(event.target.value)}
          minRows={2}
          {...common}
          className={cn(BASE_INPUT, 'resize-none')}
        />
      );
      break;

    case 'yesno':
      input = (
        <YesNoField
          field={{ ...subfield, validation: subfield.validation } as unknown as Field}
          interactive={interactive}
          value={value}
          onValueChange={onChange}
          labelledBy={labelId}
        />
      );
      break;

    case 'country':
      input = (
        <CountryField
          field={subfield as unknown as Field}
          interactive={interactive}
          value={value}
          onValueChange={onChange}
          inputId={domId}
        />
      );
      break;

    case 'single_choice':
    case 'dropdown':
      input = (
        <select
          value={text}
          onChange={(event) => onChange(event.target.value)}
          {...common}
          className={cn(BASE_INPUT, 'appearance-none')}
        >
          <option value="">Sélectionnez…</option>
          {(subfield.options ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {optionTextWithPrice(option, pricing)}
            </option>
          ))}
        </select>
      );
      break;

    case 'multiple_choice': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      input = (
        <div className="space-y-1" role="group" aria-labelledby={labelId}>
          {(subfield.options ?? []).map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                disabled={!interactive}
                checked={selected.includes(option.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option.id]
                      : selected.filter((id) => id !== option.id)
                  )
                }
                className="h-4 w-4 accent-[var(--accent)]"
              />
              {optionTextWithPrice(option, pricing)}
            </label>
          ))}
        </div>
      );
      break;
    }

    case 'currency':
      input = (
        <CurrencyField
          field={subfield as unknown as Field}
          interactive={interactive}
          value={value}
          onValueChange={onChange}
          inputId={domId}
        />
      );
      break;

    default:
      input = (
        <input
          type={inputTypeFor(subfield.type)}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          {...common}
        />
      );
  }

  return (
    <div className={subfield.type === 'long_text' ? 'sm:col-span-2' : undefined}>
      {label}
      {input}
    </div>
  );
}

/**
 * Libellé d'une option de sous-question, prix compris.
 *
 * Le prix s'affiche partout où l'on choisit, y compris dans un bloc répétable :
 * c'est précisément là qu'on facture au participant, et un menu à huit cents
 * roupies choisi sans le savoir se conteste à la réception de la facture.
 */
function optionTextWithPrice(
  option: { label?: { fr: string }; price?: number },
  pricing?: RendererPricing
): string {
  const label = option.label?.fr || '';
  if (!pricing?.enabled || !option.price) return label;
  return `${label} — ${formatMoney(option.price, pricing.currency, pricing.position)}`;
}

function inputTypeFor(type: SubField['type']): string {
  switch (type) {
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    case 'number':
      return 'number';
    case 'url':
      return 'url';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

// ============================================================================
// Champ calculé
// ============================================================================

export function CalculatedField({
  field,
  responses
}: {
  field: Field;
  responses?: Record<string, unknown>;
}) {
  // Sans configuration, la valeur serait un zéro immuable : mieux vaut dire à
  // l'auteur ce qui manque que montrer au répondant un total qui ne bouge pas.
  if (!field.calc || (field.calc.sources ?? []).length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-strong bg-bg-base px-3 py-2 text-xs text-text-tertiary">
        Aucune source — choisissez ce qui doit être compté dans le panneau de droite
      </div>
    );
  }

  const total = calcFieldValue(field, responses ?? {});

  return (
    <output
      className="flex items-center justify-between rounded-md border border-border-strong bg-bg-base px-3 py-2"
      aria-live="polite"
    >
      <span className="text-sm text-text-secondary">
        {field.calc.mode === 'count' ? 'Total compté' : 'Somme'}
      </span>
      <span className="font-display text-lg font-bold tabular-nums text-text-primary">{total}</span>
    </output>
  );
}

// ============================================================================
// Lien ou bouton
// ============================================================================

export function LinkField({ field, builder }: { field: Field; builder?: boolean }) {
  const url = field.validation?.link_url ?? '';
  const asButton = (field.validation?.link_variant ?? 'button') === 'button';
  const newTab = field.validation?.link_new_tab ?? true;
  const text = field.label?.fr || url || 'Lien';

  if (!url) {
    return (
      <div className="rounded-md border border-dashed border-border-strong bg-bg-base px-3 py-2 text-xs text-text-tertiary">
        Aucune destination — saisissez l&apos;adresse dans le panneau de droite
      </div>
    );
  }

  const target = newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {};

  // Dans l'aperçu du constructeur, le lien ne part pas : l'auteur perdrait son
  // formulaire en cliquant sur ce qu'il vient d'écrire.
  const stop = builder ? (event: React.MouseEvent) => event.preventDefault() : undefined;

  return asButton ? (
    <a
      href={url}
      {...target}
      onClick={stop}
      className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {text}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  ) : (
    <a
      href={url}
      {...target}
      onClick={stop}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent underline underline-offset-2 transition hover:brightness-110"
    >
      {text}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

// ============================================================================
// Champ caché
// ============================================================================

/**
 * Un champ caché n'apparaît jamais devant le répondant : sa valeur vient de la
 * chaîne de requête. Dans le constructeur, en revanche, il doit se voir — sinon
 * son auteur ne peut ni le retrouver ni le régler.
 */
export function HiddenField({
  field,
  builder,
  value
}: {
  field: Field;
  builder?: boolean;
  value?: unknown;
}) {
  if (!builder) return null;

  const key = field.validation?.hidden_key;

  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text-secondary">
      <EyeOff className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
      {key ? (
        <span>
          Rempli depuis <code className="font-mono text-text-primary">?{key}=</code>
        </span>
      ) : (
        <span className="text-text-tertiary">Aucune clé d&apos;URL définie</span>
      )}
      {typeof value === 'string' && value !== '' && (
        <span className="border-l border-border pl-2 font-mono text-text-primary">{value}</span>
      )}
    </div>
  );
}
