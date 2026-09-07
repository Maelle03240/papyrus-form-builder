import type {
  Field,
  FieldOption,
  Form,
  LogicRule,
  PriceTier,
  PricingConfig,
  PricingLine,
  ProjectPricing,
  Section,
  SubField,
  TieredPricing,
  TotalsSnapshot
} from '@/types';
import { DEFAULT_PROJECT_PRICING, DISCOUNT_CODE_KEY } from '@/types';
import { evaluateFormVisibility } from '@/lib/visibility';

/**
 * Calcul des totaux d'un formulaire.
 *
 * Trois principes tiennent tout le module :
 *
 * 1. **On ne facture que ce qui est à l'écran.** Le calcul part de
 *    `evaluateFormVisibility`, la même fonction que le rendu et que l'envoi. Une
 *    option cochée puis masquée par un changement de branche ne peut donc pas
 *    rester dans le total — c'est exactement le genre d'écart qu'un répondant ne
 *    découvre qu'en recevant sa facture.
 *
 * 2. **Tout est compté en centimes entiers.** Additionner des flottants — un
 *    prix à 12,10, un autre à 0,20 — dérive dès la troisième ligne, et la
 *    dérive s'imprime sur la facture. La conversion en unités n'a lieu qu'à la
 *    toute fin.
 *
 * 3. **L'instantané se suffit à lui-même.** Il porte le détail ligne à ligne, et
 *    pas seulement le total. mooove-invoice ne gardait que sous-total, TVA et
 *    total : six mois plus tard, avec des prix modifiés entre-temps, plus rien
 *    ne permettait d'expliquer une facture.
 */

// ============================================================================
// Quantités par option
//
// La réponse garde sa forme habituelle — une chaîne pour un choix unique, un
// tableau pour un choix multiple — pour que la logique conditionnelle, les
// exports et les jetons d'e-mail continuent de fonctionner sans rien savoir des
// quantités. Les compteurs vivent dans une clé voisine, `<champ>__qty`.
//
// Le suffixe est délibérément `__` : `/api/submit/[slug]` rattache déjà une clé
// à son champ en coupant sur ce séparateur, donc un compteur suit son champ —
// il est écarté avec lui quand une branche est abandonnée.
// ============================================================================

export type QuantityMap = Record<string, number>;

/** Sac de réponses : le formulaire entier, ou une ligne de bloc répétable. */
export type AnswerBag = Record<string, unknown>;

export const QUANTITY_SUFFIX = '__qty';

export function quantityKey(fieldId: string): string {
  return `${fieldId}${QUANTITY_SUFFIX}`;
}

/** Seuls les champs à choix peuvent porter un compteur. */
export function hasQuantityCounter(field: Field | SubField): boolean {
  return (
    field.pricing?.quantity?.enabled === true &&
    (field.type === 'single_choice' || field.type === 'multiple_choice')
  );
}

export function quantityBounds(field: Field | SubField): { min: number; max: number } {
  const min = Math.max(1, Math.floor(field.pricing?.quantity?.min ?? 1));
  const max = Math.floor(field.pricing?.quantity?.max ?? 99);
  return { min, max: Math.max(min, max) };
}

export function clampQuantity(field: Field | SubField, value: number): number {
  const { min, max } = quantityBounds(field);
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function readQuantityMap(bag: AnswerBag | undefined, fieldId: string): QuantityMap {
  const raw = bag?.[quantityKey(fieldId)];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: QuantityMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const count = Number(value);
    if (Number.isFinite(count) && count > 0) out[key] = Math.round(count);
  }
  return out;
}

/**
 * Nombre d'unités de l'option retenue.
 *
 * Vaut toujours 1 quand le champ n'a pas de compteur, pour que l'appelant puisse
 * multiplier sans condition.
 */
export function optionQuantity(
  field: Field | SubField,
  bag: AnswerBag | undefined,
  optionId: string
): number {
  if (!hasQuantityCounter(field)) return 1;
  const stored = readQuantityMap(bag, field.id)[optionId];
  return stored ? clampQuantity(field, stored) : quantityBounds(field).min;
}

// ============================================================================
// Résolution de la configuration
// ============================================================================

/**
 * Combine les réglages du projet et ceux du formulaire.
 *
 * Le formulaire l'emporte quand il renseigne une clé. La résolution a lieu à la
 * lecture, jamais à l'écriture : changer la devise d'un projet doit se répercuter
 * sur ses formulaires, pas les laisser figés sur l'ancienne.
 */
export function resolvePricing(
  form: Pick<Form, 'pricing_config' | 'project_pricing'>
): PricingConfig & ProjectPricing {
  const project = { ...DEFAULT_PROJECT_PRICING, ...(form.project_pricing ?? {}) };
  const own = form.pricing_config ?? { enabled: false };

  return {
    ...own,
    enabled: own.enabled === true,
    currency: own.currency?.trim() || project.currency,
    currency_position: own.currency_position ?? project.currency_position,
    vat_enabled: own.vat_enabled ?? project.vat_enabled,
    vat_rate: own.vat_rate ?? project.vat_rate
  };
}

/**
 * Le formulaire a-t-il de quoi produire un total ?
 *
 * Un bloc de totaux à zéro sur un formulaire sans le moindre prix n'apprend rien
 * au répondant et l'inquiète pour rien.
 */
export function hasPricedFields(fields: Field[]): boolean {
  const priced = (field: Field | SubField): boolean =>
    (field.options ?? []).some((option) => Number(option.price) > 0) ||
    (field.pricing?.count_in_total === true &&
      (field.type === 'number' || field.type === 'currency'));

  for (const field of fields) {
    if (priced(field)) return true;
    if (field.repeater) {
      for (const sub of field.repeater.fields) if (priced(sub)) return true;
    }
  }
  return false;
}

// ============================================================================
// Tarifs dégressifs
// ============================================================================

export interface TierInfo {
  price: number;
  index: number;
  label: string;
  /** Les inscriptions sont closes : dernier seuil dépassé, et fermeture demandée. */
  closed: boolean;
  /** Places restantes avant le seuil suivant. `null` = pas de seuil suivant. */
  remaining: number | null;
  next_price: number | null;
}

/** Le palier actif, compte tenu du nombre d'inscriptions déjà enregistrées. */
export function resolveTier(tiered: TieredPricing, registeredCount: number): TierInfo {
  const tiers = (tiered.tiers ?? []).filter((tier) => typeof tier.price === 'number');

  if (tiers.length === 0) {
    return { price: 0, index: 0, label: '', closed: false, remaining: null, next_price: null };
  }

  for (let index = 0; index < tiers.length; index++) {
    const tier: PriceTier = tiers[index];
    const unbounded = tier.up_to == null || tier.up_to <= 0;

    if (unbounded || registeredCount < tier.up_to!) {
      const next = tiers[index + 1];
      return {
        price: tier.price,
        index,
        label: tier.label ?? '',
        closed: false,
        remaining: unbounded ? null : tier.up_to! - registeredCount,
        next_price: next ? next.price : null
      };
    }
  }

  const last = tiers[tiers.length - 1];

  if (tiered.after_last === 'close') {
    return {
      price: last.price,
      index: tiers.length,
      label: last.label ?? '',
      closed: true,
      remaining: 0,
      next_price: null
    };
  }

  return {
    price: last.price,
    index: tiers.length - 1,
    label: last.label ?? '',
    closed: false,
    remaining: null,
    next_price: null
  };
}

/** Combien d'inscriptions cette réponse représente. */
export function registrationUnits(tiered: TieredPricing, responses: AnswerBag): number {
  if (tiered.count_by !== 'participant' || !tiered.participant_field_id) return 1;

  const rows = responses[tiered.participant_field_id];
  return Array.isArray(rows) ? rows.length : 0;
}

// ============================================================================
// Calcul
// ============================================================================

export interface PricingInput {
  fields?: Field[];
  sections?: Section[];
  logic_rules?: LogicRule[];
}

/** Convertit un prix saisi en centimes entiers. */
function toCents(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : 0;
  if (typeof value !== 'string') return 0;

  // Une saisie à la française — « 12,50 » — est un montant, pas zéro. On retire
  // aussi les espaces et symboles qu'un répondant colle depuis ailleurs.
  const cleaned = value.replace(',', '.').replace(/[^0-9.\-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Les options retenues d'un champ à choix, dans l'ordre du formulaire. */
function selectedOptions(field: Field | SubField, value: unknown): FieldOption[] {
  const ids = Array.isArray(value)
    ? value.map(String)
    : value != null && value !== ''
      ? [String(value)]
      : [];

  return (field.options ?? []).filter((option) => ids.includes(option.id));
}

/** Lignes produites par un champ. */
function linesForField(
  field: Field | SubField,
  value: unknown,
  bag: AnswerBag,
  labelPrefix = ''
): PricingLine[] {
  const label = (field.label?.fr || 'Question sans titre').trim();

  if (field.type === 'single_choice' || field.type === 'multiple_choice' || field.type === 'dropdown') {
    return selectedOptions(field, value)
      .filter((option) => Number(option.price) > 0)
      .map((option) => {
        const quantity = optionQuantity(field, bag, option.id);
        const unitCents = toCents(option.price);
        return {
          field_id: field.id,
          label: labelPrefix ? `${labelPrefix} — ${label}` : label,
          detail: option.label?.fr || '',
          quantity,
          unit_price: fromCents(unitCents),
          amount: fromCents(unitCents * quantity)
        };
      });
  }

  if (
    field.pricing?.count_in_total === true &&
    (field.type === 'number' || field.type === 'currency')
  ) {
    const cents = toCents(value);
    if (cents === 0) return [];
    return [
      {
        field_id: field.id,
        label: labelPrefix ? `${labelPrefix} — ${label}` : label,
        quantity: 1,
        unit_price: fromCents(cents),
        amount: fromCents(cents)
      }
    ];
  }

  return [];
}

/**
 * Le détail des lignes, pour les seuls champs réellement affichés.
 *
 * Les blocs répétables sont parcourus ligne à ligne : chacune peut porter ses
 * propres options payantes, et c'est ce qui permet de facturer un tarif par
 * participant.
 */
export function computeLines(form: PricingInput, responses: AnswerBag): PricingLine[] {
  const fields = form.fields ?? [];
  const visible = evaluateFormVisibility(form, responses).fields;
  const lines: PricingLine[] = [];

  for (const field of fields) {
    if (!visible.has(field.id)) continue;

    if (field.type === 'repeater' && field.repeater) {
      const rows = Array.isArray(responses[field.id])
        ? (responses[field.id] as AnswerBag[])
        : [];
      const itemLabel = field.repeater.item_label?.fr || 'Ligne';

      rows.forEach((row, index) => {
        for (const sub of field.repeater!.fields) {
          lines.push(...linesForField(sub, row?.[sub.id], row ?? {}, `${itemLabel} ${index + 1}`));
        }
      });
      continue;
    }

    lines.push(...linesForField(field, responses[field.id], responses));
  }

  return lines;
}

/**
 * Totaux complets. `registeredCount` n'est lu que par les tarifs dégressifs.
 *
 * Le résultat est exactement ce qui sera figé sur la réponse : la même fonction
 * alimente l'affichage en direct et l'enregistrement, donc le répondant ne peut
 * pas voir un montant et en payer un autre.
 */
export function computeTotals(
  form: PricingInput,
  responses: AnswerBag,
  pricing: PricingConfig & ProjectPricing,
  registeredCount = 0
): TotalsSnapshot {
  const lines = computeLines(form, responses);
  let subtotalCents = lines.reduce((sum, line) => sum + toCents(line.amount), 0);

  let registration: TotalsSnapshot['registration'];

  if (pricing.tiered?.enabled) {
    const tier = resolveTier(pricing.tiered, registeredCount);
    const units = registrationUnits(pricing.tiered, responses);
    const amountCents = toCents(tier.price) * units;

    subtotalCents += amountCents;
    registration = {
      label: pricing.tiered.registration_label || 'Inscription',
      units,
      unit_price: tier.price,
      amount: fromCents(amountCents),
      tier_label: tier.label
    };
  }

  const entered = String(responses[DISCOUNT_CODE_KEY] ?? '').trim();
  const matched =
    pricing.discount_enabled && entered
      ? (pricing.discounts ?? []).find(
          (discount) => discount.code.trim().toLowerCase() === entered.toLowerCase()
        )
      : undefined;

  const discountPercent = matched ? Math.min(100, Math.max(0, Number(matched.percent) || 0)) : 0;
  const discountCents = Math.round((subtotalCents * discountPercent) / 100);
  const netCents = Math.max(0, subtotalCents - discountCents);

  const vatRate = pricing.vat_enabled ? pricing.vat_rate : 0;
  const vatCents = Math.round((netCents * vatRate) / 100);

  return {
    currency: pricing.currency,
    currency_position: pricing.currency_position,
    lines,
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    discount_percent: discountPercent,
    discount_code: discountPercent > 0 ? entered : '',
    vat: fromCents(vatCents),
    vat_rate: vatRate,
    total: fromCents(netCents + vatCents),
    subtotal_label: pricing.subtotal_label || 'Sous-total',
    discount_label: pricing.discount_label || 'Remise',
    vat_label: pricing.vat_label || 'TVA',
    total_label: pricing.total_label || 'Total',
    registration
  };
}

// ============================================================================
// Affichage
// ============================================================================

export function formatMoney(
  amount: number,
  currency = DEFAULT_PROJECT_PRICING.currency,
  position: 'before' | 'after' = 'before'
): string {
  // Espace fine insécable entre les groupes de milliers : c'est la convention
  // française, et elle évite qu'un montant se coupe en fin de ligne.
  const rendered = (Math.round(amount * 100) / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  return position === 'after' ? `${rendered} ${currency}` : `${currency} ${rendered}`;
}

export type DiscountStatus = 'none' | 'valid' | 'invalid';

export function discountStatus(pricing: PricingConfig, code: string): DiscountStatus {
  const trimmed = code.trim().toLowerCase();
  if (!trimmed) return 'none';

  return (pricing.discounts ?? []).some(
    (discount) => discount.code.trim().toLowerCase() === trimmed
  )
    ? 'valid'
    : 'invalid';
}
