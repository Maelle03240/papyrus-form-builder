import { slugify } from '@/lib/utils';
import {
  DEFAULT_PARTNER_CONFIG,
  type CommissionConfirmedBy,
  type MultilingualText,
  type PartnerConfig,
  type PartnerRegistration,
  type SubmissionStatus,
  type TotalsSnapshot
} from '@/types';

/**
 * Le calcul des commissions et la fabrique des liens partenaire.
 *
 * Un seul module, importable des deux côtés : le tableau du personnel et le
 * portail du partenaire doivent afficher le même chiffre au centime près. En
 * mettre un dans une page serveur et l'autre dans un composant client, c'est
 * garantir qu'ils divergeront le jour où l'un des deux sera corrigé.
 */

// ============================================================================
// Le registre : trois états, et rien entre les deux
// ============================================================================

/**
 * Où en est une commission.
 *
 * Les trois états sont ceux de mooove-invoice, parce qu'ils décrivent ce qui se
 * passe réellement : le client n'a pas encore payé, il a payé et nous devons
 * l'argent au partenaire, le partenaire a été payé.
 *
 * L'ordre compte : une commission ne peut pas sauter d'étape. En particulier
 * `received` est inatteignable tant que le client n'a pas payé — verser une
 * commission sur une inscription impayée, c'est payer deux fois quand elle est
 * finalement annulée.
 */
export type CommissionStage = 'awaiting_client' | 'to_pay' | 'received';

export const COMMISSION_STAGE_LABELS: Record<CommissionStage, string> = {
  awaiting_client: 'En attente du paiement client',
  to_pay: 'À verser',
  received: 'Versée'
};

export interface CommissionLedger {
  /** Le client n'a pas encore payé : rien n'est dû. */
  awaitingClient: number;
  /** Le client a payé : la commission est acquise (versée ou non). */
  earned: number;
  /** Acquise et pas encore versée — ce que l'on doit aujourd'hui. */
  toPay: number;
  /** Acquise et versée. */
  received: number;
  /** Nombre de lignes encore à verser, pour dire « 3 inscriptions ». */
  outstandingCount: number;
  /** Devise du registre, tirée des instantanés de prix. */
  currency: string;
  currencyPosition: 'before' | 'after';
}

export function emptyLedger(): CommissionLedger {
  return {
    awaitingClient: 0,
    earned: 0,
    toPay: 0,
    received: 0,
    outstandingCount: 0,
    currency: '',
    currencyPosition: 'before'
  };
}

/** Le taux appliqué à un projet, ramené à une valeur utilisable. */
export function commissionPercent(config: PartnerConfig | null | undefined): number {
  const raw = Number(config?.commission_percent ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // Un taux supérieur à 100 % est une faute de frappe, pas une intention : le
  // borner ici évite qu'une commission dépasse le montant de l'inscription.
  return Math.min(raw, 100);
}

/**
 * Ce que rapporte une réponse.
 *
 * Toujours calculée sur l'instantané de prix figé à l'envoi, jamais sur les
 * tarifs du jour : c'est la décision de la phase 3, et c'est ce qui permet de
 * régler une commission six mois plus tard sans rouvrir la grille tarifaire.
 *
 * Une réponse annulée ne rapporte rien — sinon annuler une inscription
 * laisserait une dette derrière elle.
 */
export function commissionOn(
  pricing: TotalsSnapshot | null | undefined,
  status: SubmissionStatus,
  percent: number
): number {
  if (status === 'void' || percent <= 0) return 0;
  const total = pricing?.total;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return 0;
  return round2((total * percent) / 100);
}

export function stageOf(row: {
  status: SubmissionStatus;
  commission_paid_at: string | null;
}): CommissionStage {
  if (row.commission_paid_at) return 'received';
  return row.status === 'paid' ? 'to_pay' : 'awaiting_client';
}

/**
 * Le registre d'un ensemble de lignes.
 *
 * `earned` n'est pas une quatrième colonne à additionner : c'est la somme de
 * `toPay` et `received`. Les afficher côte à côte sans le dire produirait un
 * total apparent qui compte deux fois le même argent.
 */
export function buildLedger(rows: PartnerRegistration[]): CommissionLedger {
  const ledger = emptyLedger();

  for (const row of rows) {
    const status = normalizeStatus(row.status);
    if (status === 'void') continue;

    const amount = commissionOn(row.pricing, status, clampPercent(row.commission_percent));
    if (amount <= 0) continue;

    if (!ledger.currency && row.pricing?.currency) {
      ledger.currency = row.pricing.currency;
      ledger.currencyPosition = row.pricing.currency_position ?? 'before';
    }

    switch (stageOf({ status, commission_paid_at: row.commission_paid_at })) {
      case 'awaiting_client':
        ledger.awaitingClient = round2(ledger.awaitingClient + amount);
        break;
      case 'to_pay':
        ledger.earned = round2(ledger.earned + amount);
        ledger.toPay = round2(ledger.toPay + amount);
        ledger.outstandingCount += 1;
        break;
      case 'received':
        ledger.earned = round2(ledger.earned + amount);
        ledger.received = round2(ledger.received + amount);
        break;
    }
  }

  return ledger;
}

/**
 * Une commission peut-elle être marquée versée ?
 *
 * Le garde-fou vit ici et non dans la route, parce que les deux côtés posent la
 * question : le portail pour griser son bouton, la route pour refuser l'appel.
 */
export function canSettle(row: {
  status: SubmissionStatus;
  commission_paid_at: string | null;
}): boolean {
  return row.status === 'paid' && !row.commission_paid_at;
}

export function confirmedByLabel(by: CommissionConfirmedBy): string {
  switch (by) {
    case 'partner':
      return 'confirmée par le partenaire';
    case 'staff':
      return 'marquée par l’équipe';
    default:
      return '';
  }
}

// ============================================================================
// Les liens
// ============================================================================

/**
 * Alphabet des codes de partage.
 *
 * Sans `i`, `l`, `o`, `0` ni `1` : un code de partage est lu au téléphone et
 * recopié à la main. « l » et « 1 » se confondent dans presque toutes les
 * polices, et le visiteur qui se trompe tombe sur une 404 sans comprendre
 * pourquoi — pendant que le partenaire, lui, croit son lien cassé.
 */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Partie lisible d'un code, tirée du nom du partenaire.
 *
 * Bâtie sur le `slugify` du produit plutôt que sur une seconde expression
 * régulière : deux normalisations d'accents qui divergent finiraient par donner
 * deux codes différents pour le même nom.
 */
export function slugifyPartner(name: string): string {
  // Plus court qu'un slug de formulaire : le code est lu au téléphone, et la
  // moitié d'une raison sociale suffit à le reconnaître.
  const base = slugify(name).slice(0, 24).replace(/-+$/g, '');
  return base || 'partenaire';
}

/**
 * Un code de partage : le nom du partenaire, puis quatre caractères tirés au
 * sort.
 *
 * Le suffixe aléatoire n'est pas un ornement : sans lui, deux partenaires
 * homonymes sur deux projets se disputeraient le même code, et le second
 * échouerait à la création sans que personne comprenne pourquoi.
 */
export function generatePartnerCode(name: string, random: () => number = Math.random): string {
  let suffix = '';
  for (let i = 0; i < 4; i += 1) {
    suffix += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return `${slugifyPartner(name)}-${suffix}`;
}

/** Le code n'accepte que ce que la fabrique produit. */
export function isValidPartnerCode(code: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,40}$/.test(code);
}

export function landingPath(code: string): string {
  return `/a/${code}`;
}

export function portalPath(token: string): string {
  return `/p/${token}`;
}

export function joinPath(token: string): string {
  return `/a/join/${token}`;
}

/**
 * L'adresse du formulaire pour un visiteur venu d'un lien partenaire.
 *
 * Le code voyage dans l'URL et non dans un cookie : un cookie survivrait à la
 * visite d'un autre lien et attribuerait l'inscription au mauvais partenaire —
 * exactement le litige qu'un programme d'apporteurs d'affaires ne peut pas se
 * permettre.
 */
export function attributedFormPath(slug: string, code: string): string {
  return `/f/${slug}?a=${encodeURIComponent(code)}`;
}

/** Le paramètre d'URL qui porte l'attribution, d'un bout à l'autre du parcours. */
export const PARTNER_CODE_PARAM = 'a';

// ============================================================================
// La page d'accueil
// ============================================================================

export function partnerConfigOf(value: unknown): PartnerConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_PARTNER_CONFIG };
  }
  return { ...DEFAULT_PARTNER_CONFIG, ...(value as PartnerConfig) };
}

/**
 * Les libellés par défaut de la page d'accueil.
 *
 * Un programme partenaire activé sans une ligne de texte doit produire une page
 * juste, pas une page vide : le nom du projet suffit à faire un titre, et
 * « S'inscrire » suffit à faire un bouton.
 */
export function landingHeading(config: PartnerConfig, projectName: string, language: string): string {
  return pick(config.heading, language) || projectName;
}

export function landingCta(config: PartnerConfig, language: string): string {
  return pick(config.cta_label, language) || (language === 'en' ? 'Register' : 'S’inscrire');
}

export function landingPartnerLabel(config: PartnerConfig, language: string): string {
  return (
    pick(config.partner_label, language) ||
    (language === 'en' ? 'In partnership with' : 'En partenariat avec')
  );
}

export function joinHeading(config: PartnerConfig, projectName: string, language: string): string {
  return (
    pick(config.join_heading, language) ||
    (language === 'en' ? `Become a partner — ${projectName}` : `Devenir partenaire — ${projectName}`)
  );
}

function pick(text: MultilingualText | undefined, language: string): string {
  if (!text) return '';
  return (text[language] || text.fr || text.en || '').trim();
}

// ============================================================================
// Outils
// ============================================================================

function clampPercent(value: number | null | undefined): number {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, 100);
}

function normalizeStatus(value: string): SubmissionStatus {
  return (['submitted', 'reviewed', 'paid', 'void'] as const).includes(value as SubmissionStatus)
    ? (value as SubmissionStatus)
    : 'submitted';
}

/**
 * Les montants sont arrondis au centime À CHAQUE addition, pas seulement à
 * l'affichage. Un taux de 12,5 % sur onze inscriptions produit sinon un total
 * qui ne correspond à aucune somme de lignes visibles, et c'est celui-là qu'on
 * verse.
 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
