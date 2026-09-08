// types/index.ts — Source unique de vérité pour les types Papyrus

export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'url'
  | 'single_choice'
  | 'multiple_choice'
  | 'dropdown'
  | 'rating'
  | 'nps'
  | 'date'
  | 'file'
  | 'statement'
  | 'image'
  | 'video'
  | 'matrix'
  // Ajoutés en phase 2 — parité avec mooove-invoice.
  | 'currency'
  | 'address'
  | 'country'
  | 'yesno'
  | 'signature'
  | 'repeater'
  | 'calculated'
  | 'link'
  | 'hidden'
  | 'divider';

/**
 * Types de champ qui ne collectent aucune réponse du répondant.
 *
 * `calculated` n'en fait pas partie : sa valeur est calculée, mais elle est bel
 * et bien enregistrée avec la réponse — c'est tout l'intérêt du champ.
 */
export const NON_ANSWERABLE_FIELD_TYPES = [
  'statement',
  'image',
  'video',
  'divider',
  'link'
] as const;

/**
 * Types de champ auxquels « obligatoire » ne veut rien dire.
 *
 * `hidden` et `calculated` portent une valeur que le répondant ne saisit pas :
 * l'exiger bloquerait l'envoi sur un champ qu'il n'a jamais vu, sans qu'aucun
 * message ne puisse désigner quoi que ce soit à l'écran.
 */
export const NEVER_REQUIRED_FIELD_TYPES = [
  ...NON_ANSWERABLE_FIELD_TYPES,
  'hidden',
  'calculated'
] as const;

/**
 * Types autorisés à l'intérieur d'un répéteur.
 *
 * La liste est fermée à dessein : `SubField.type` est un `FieldType` complet,
 * donc rien dans le typage n'empêche un répéteur de contenir un répéteur. Le
 * rendu partirait alors en récursion infinie à la première ligne ajoutée.
 */
export const REPEATER_SUBFIELD_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'currency',
  'url',
  'date',
  'country',
  'yesno',
  'single_choice',
  'multiple_choice',
  'dropdown'
] as const;

export type DisplayMode = 'scroll' | 'sections' | 'typeform';
export type FormStatus = 'draft' | 'published' | 'closed';
export type AccessType = 'public' | 'private' | 'password';
export type TeamRole = 'admin' | 'member';

/**
 * Périmètre d'un modèle (template).
 * - `personal` : visible uniquement par son créateur
 * - `workspace` : partagé avec son équipe (workspace = `team` dans la BDD)
 * - `global` : modèle officiel Mooove, visible par tous
 */
export type FormScope = 'personal' | 'workspace' | 'global';

export interface MultilingualText {
  fr: string;
  en?: string;
  es?: string;
  [lang: string]: string | undefined;
}

export interface FieldOption {
  id: string;
  label: MultilingualText;
  value?: string;
  /** Points attribués à cette option dans le système de scoring (0 par défaut) */
  points?: number;
  /**
   * Prix de l'option, dans la devise du projet.
   *
   * Il vit sur l'option et non dans un réglage à part, parce que c'est l'option
   * qui est vendue : la renommer, la déplacer ou la dupliquer emporte son prix.
   */
  price?: number;
}

/**
 * Sous-champ d'une question — utilise (presque) la même forme qu'un Field, sans les métadonnées
 * du formulaire (form_id, field_order). Les sous-champs s'appliquent à toutes les options cochées
 * d'un multiple_choice : leur valeur est collectée séparément pour chaque option cochée.
 */
export interface SubField {
  id: string;
  type: FieldType;
  label: MultilingualText;
  description: MultilingualText;
  placeholder: MultilingualText;
  options: FieldOption[];
  rows?: FieldOption[];
  required: boolean;
  validation: FieldValidation;
  style?: FieldStyle;
  /**
   * Participation au total — comme pour un champ.
   *
   * Une sous-question porte bel et bien des prix : c'est ainsi qu'on facture un
   * tarif par participant, chacun choisissant son option dans sa propre ligne.
   */
  pricing?: FieldPricing;
}

export interface FieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  accept?: string[]; // pour fichiers
  default_country?: string; // ISO 2-letter pour le champ phone
  // Pour les champs Image, Vidéo, Fichier — modes créateur/répondant
  creator_mode_enabled?: boolean; // Si le créateur peut ajouter du contenu
  respondent_mode_enabled?: boolean; // Si le répondant peut uploader du contenu
  media_url?: string; // URL ou data URL du contenu ajouté par le créateur
  max_file_size_mb?: number; // Taille max des fichiers pour le mode répondant (1-50 MB)
  alignment?: 'left' | 'center' | 'right'; // pour l'alignement du contenu créateur
  image_width?: number; // Largeur de l'image en pixels (pour type 'image')
  image_height?: number; // Hauteur de l'image en pixels (pour type 'image')
  show_title?: boolean; // Pour 'image' et 'video' — affiche le titre au-dessus du contenu
  original_width?: number; // Largeur d'origine de l'image (pour le reset)
  original_height?: number; // Hauteur d'origine de l'image (pour le reset)
  ratio_locked?: boolean; // Pour 'image' — verrouillage du ratio d'aspect (défaut: true)
  image_position_x?: number; // Position X de l'image sur le canvas (en px)
  image_position_y?: number; // Position Y de l'image sur le canvas (en px)
  // Pour les champs réponse courte avec type numérique
  response_type?: 'text' | 'integer' | 'decimal'; // Type de réponse pour short_text
  max_decimals?: number; // Nombre max de décimales pour type decimal (1-3)
  unit?: 'none' | 'euro' | 'dollar' | 'pound' | 'rupee' | 'mur' | 'kg' | 'g' | 'lb' | 'cm' | 'm' | 'ft' | 'in' | 'miles' | 'arpent' | 'percent'; // Unité pour les nombres
  user_can_choose_unit?: boolean; // Si l'utilisateur peut choisir l'unité
  // Pour les champs bannière et logo
  banner_fit?: 'cover' | 'contain'; // pour 'banner' — mode d'affichage
  banner_position_x?: number; // pour 'banner' — position horizontale (0-100)
  banner_position_y?: number; // pour 'banner' — position verticale (0-100)
  full_width?: boolean; // pour 'banner' et 'logo' — largeur plein écran
  logo_size?: 'sm' | 'md' | 'lg'; // pour 'logo' — taille du logo
  logo_position_x?: number; // pour 'logo' — position horizontale (0-100)
  logo_position_y?: number; // pour 'logo' — position verticale (0-100)
  logo_shape?: 'circle' | 'rounded' | 'rectangle'; // pour 'logo' — forme
  matrix_mode?: 'single' | 'multiple'; // pour 'matrix'
  has_other?: boolean; // pour les champs à choix : ajoute une option "Autre" avec texte libre
  other_label?: string; // libellé de l'option "Autre" (par défaut : "Autre")
  options_columns?: 1 | 2 | 3; // nombre de colonnes pour disposer les options
  display_style?: 'cards' | 'buttons' | 'slider'; // pour 'single_choice' ou 'nps'
  has_subfields?: boolean; // pour 'multiple_choice' — active les sous-questions appliquées à chaque option cochée
  randomize_options?: boolean; // pour les champs à choix — mélange l'ordre des options côté répondant
  selection_min?: number; // pour 'multiple_choice' — nombre minimum de cases à cocher
  selection_max?: number; // pour 'multiple_choice' — nombre maximum de cases à cocher
  nps_left_label?: string; // Libellé gauche (min) pour l'échelle de notation
  nps_right_label?: string; // Libellé droite (max) pour l'échelle de notation

  // --- Champs ajoutés en phase 2 ---
  //
  // Ces réglages vivent dans `validation` et non dans une colonne à eux, par
  // cohérence avec ce qui précède : `validation` est le sac de configuration
  // d'un champ, et non ses seules contraintes de saisie — `media_url`,
  // `logo_shape` ou `display_style` y sont déjà. Seuls `repeater` et `calc`
  // méritent une colonne : ils portent une structure, pas un réglage.

  /** Code ISO 4217 pour `currency` — hérité du projet en phase 3. */
  currency_code?: string;
  /** Position du symbole monétaire pour `currency`. */
  currency_position?: 'before' | 'after';
  /** Pour `yesno` — libellés des deux boutons. */
  yes_label?: string;
  no_label?: string;
  /** Pour `country` — code ISO présélectionné. */
  default_country_code?: string;
  /** Pour `address` — nombre de lignes du champ de saisie. */
  address_rows?: number;
  /** Pour `link` — destination, apparence et cible du lien affiché. */
  link_url?: string;
  link_variant?: 'button' | 'link';
  link_new_tab?: boolean;
  /**
   * Pour `hidden` — clé de la chaîne de requête qui pré-remplit le champ.
   *
   * `?utm_source=linkedin` renseigne le champ dont `hidden_key` vaut
   * `utm_source`. C'est ainsi qu'on rattache une réponse à sa campagne sans rien
   * demander au répondant.
   */
  hidden_key?: string;
  /** Pour `hidden` — valeur retenue quand la clé est absente de l'URL. */
  hidden_default?: string;
  /** Pour `signature` — épaisseur du trait, en pixels. */
  signature_stroke_width?: number;
}

/** Familles disponibles dans le sélecteur de police par champ.
 *  - `sans` / `display` → Aktiv Grotesk (défaut Mooove). Les deux mappent à la même police.
 *  - `serif` → Georgia (identité Papyrus, en option pour les titres / textes avec caractère).
 *  - `mono` → JetBrains Mono. */
export type FontFamily = 'sans' | 'display' | 'serif' | 'mono';
export type LabelSize = 'sm' | 'md' | 'lg' | 'xl';
export type LabelWeight = 'normal' | 'medium' | 'bold';
export type TextAlign = 'left' | 'center' | 'right';

export interface FieldStyle {
  label_color?: string;
  label_size?: LabelSize;
  label_weight?: LabelWeight;
  label_align?: TextAlign;
  label_italic?: boolean;
  font_family?: FontFamily;
  icon_enabled?: boolean;
  icon_value?: string;
}

export type LayoutWidth = 'full' | 'half';

export interface Field {
  id: string;
  form_id: string;
  /**
   * Section à laquelle appartient le champ. Obligatoire : depuis la migration
   * 004, tout formulaire possède au moins une section et aucun champ ne flotte
   * hors de l'une d'elles.
   */
  section_id: string;
  type: FieldType;
  label: MultilingualText;
  description: MultilingualText;
  placeholder: MultilingualText;
  options: FieldOption[]; // pour 'matrix' = colonnes
  rows?: FieldOption[]; // uniquement pour 'matrix' = lignes
  required: boolean;
  field_order: number;
  validation: FieldValidation;
  style?: FieldStyle;
  /** Largeur dans la mise en page : 'full' (défaut, 1/1) ou 'half' (1/2 — permet 2 par ligne). */
  layout_width?: LayoutWidth;
  /**
   * Sous-champs (multiple_choice seulement) — un seul jeu de sous-questions, appliqué à
   * chaque option cochée par le répondant. Les colonnes générées en BDD respectent le format
   * `[field_id]__[option_slug]__[subfield_id]`.
   */
  subfields?: SubField[];
  /**
   * Verrou d'affichage propre au champ — cf. `VisibilityRule`. Absent ou vide,
   * le champ ne dépend que des règles de logique du formulaire.
   */
  visibility?: VisibilityRule;
  /** Uniquement pour `repeater`. */
  repeater?: FieldRepeater;
  /** Uniquement pour `calculated`. */
  calc?: FieldCalc;
  /** Participation du champ au total — cf. `FieldPricing`. */
  pricing?: FieldPricing;
  created_at?: string;
}

/**
 * Une section d'un formulaire.
 *
 * Elle a remplacé le pseudo-champ `section_break`. Le marqueur planté dans la
 * liste plate suffisait tant qu'une section n'était qu'un titre ; il ne permet
 * ni de porter des conditions d'affichage propres, ni de déplacer un bloc d'un
 * geste, ni d'être créée par un appel d'outil.
 *
 * Un titre vide est normal : c'est la section d'ouverture d'un formulaire qui
 * commence directement par ses questions.
 */
export interface Section {
  id: string;
  form_id: string;
  title: MultilingualText;
  description: MultilingualText;
  section_order: number;
  /**
   * Verrou d'affichage de la section — cf. `VisibilityRule`. Fermé, il emporte
   * toutes les questions de la section : aucune n'est affichée, aucune n'est
   * exigée, et les réponses déjà saisies sont écartées à l'envoi.
   */
  visibility?: VisibilityRule;
  /**
   * Section retirée du formulaire mais conservée dans le constructeur.
   *
   * Ce n'est pas la même chose qu'un verrou fermé : `hidden` est une décision de
   * l'auteur, indépendante des réponses, et il n'existe aucune combinaison de
   * réponses qui la rouvre.
   */
  hidden?: boolean;
  /** Les champs de la section, triés par `field_order` (relatif à la section). */
  fields?: Field[];
  created_at?: string;
}

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  /** La question a reçu une réponse, quelle qu'elle soit. */
  | 'is_filled'
  /** La question est restée sans réponse. */
  | 'is_empty';

export interface LogicCondition {
  source_field_id: string;
  operator: ConditionOperator;
  /** Ignorée par `is_filled` et `is_empty`, qui ne comparent rien. */
  value: string;
}

/**
 * Condition d'affichage portée par le champ ou la section lui-même.
 *
 * Deux mécanismes cohabitent, et ce n'est pas un doublon — ils s'écrivent depuis
 * deux endroits opposés :
 *
 * · `LogicRule` s'écrit depuis la question **source** : « quand on répond oui à
 *   celle-ci, montrer celle-là ». C'est le point de vue du parcours, et c'est
 *   aussi le seul qui sache faire un saut de page.
 * · `VisibilityRule` s'écrit depuis l'élément **cible** : « n'affiche-moi que
 *   si… ». C'est le point de vue de la question, et c'est le seul praticable
 *   quand une même question dépend de trois autres.
 *
 * Règle d'arbitrage, valable partout : la visibilité est un **verrou**, jamais
 * un ordre d'affichage. Un élément est visible si les règles de logique le
 * disent visible **et** que son verrou s'ouvre. Une `VisibilityRule` ne peut
 * donc jamais forcer l'apparition de ce qu'une règle `hide_field` masque —
 * sinon deux auteurs, chacun dans son panneau, écriraient l'inverse l'un de
 * l'autre sans jamais voir le conflit.
 *
 * Une liste de conditions vide ouvre le verrou : c'est l'état par défaut.
 */
export interface VisibilityRule {
  conditions: LogicCondition[];
  operator: 'AND' | 'OR';
}

export const EMPTY_VISIBILITY: VisibilityRule = { conditions: [], operator: 'AND' };

/**
 * Configuration d'un champ « répéteur » : un bloc de sous-questions que le
 * répondant duplique autant de fois qu'il le faut (des participants, des
 * accompagnants, des lignes de commande).
 *
 * La réponse enregistrée est un tableau de lignes, chaque ligne étant un objet
 * `{ [id du sous-champ]: valeur }`.
 */
export interface FieldRepeater {
  /** Nombre de lignes en dessous duquel le répondant ne peut pas descendre. */
  min: number;
  max: number;
  /** Nom d'une ligne au singulier — « Participant », « Article ». */
  item_label: MultilingualText;
  fields: SubField[];
}

export type CalcMode = 'count' | 'sum';

/**
 * Configuration d'un champ calculé — une valeur en lecture seule, recalculée à
 * chaque frappe et enregistrée avec la réponse.
 *
 * `count` compte les lignes des répéteurs cités ; `sum` additionne la valeur des
 * champs numériques cités. `offset` s'ajoute au résultat, ce qui couvre le cas
 * courant du « nombre de participants + l'organisateur ».
 */
export interface FieldCalc {
  mode: CalcMode;
  /** Identifiants des champs sources. */
  sources: string[];
  offset: number;
  /**
   * Calculer et enregistrer la valeur sans jamais la montrer au répondant —
   * utile pour un total qui n'intéresse que l'organisateur.
   */
  hidden?: boolean;
}
export type LogicAction = 'show_field' | 'hide_field' | 'jump_to' | 'end_form';

export interface LogicRule {
  id: string;
  form_id: string;
  conditions: LogicCondition[];
  conditions_operator: 'AND' | 'OR';
  action_type: LogicAction;
  target_field_id?: string | null;
  /**
   * Cible d'un « aller à » qui vise une section.
   *
   * Deux colonnes plutôt qu'une : `target_field_id` porte une clé étrangère vers
   * `fields`, où les sections ne vivent plus. Exactement l'une des deux est
   * renseignée.
   */
  target_section_id?: string | null;
  rule_order: number;
}

// ============================================================================
// Tarification
//
// Règle de répartition, la même que partout : une configuration qui référence
// des champs appartient au formulaire ; tout le reste appartient au projet. La
// devise et la TVA sont donc portées par le projet — un même événement facture
// dans une seule monnaie, quel que soit le formulaire —, et les prix, les
// remises et les paliers par le formulaire, parce qu'ils désignent ses options.
// ============================================================================

export interface DiscountCode {
  id: string;
  code: string;
  /** Remise en pourcentage du sous-total. */
  percent: number;
  label?: string;
}

/**
 * Un palier de tarif dégressif — le tarif « early bird » et ses suites.
 *
 * `up_to` est un seuil **cumulé** : le palier s'applique tant que le nombre
 * d'inscriptions lui reste inférieur. `null` signifie « et au-delà ».
 */
export interface PriceTier {
  up_to: number | null;
  price: number;
  label?: string;
}

export interface TieredPricing {
  enabled: boolean;
  /**
   * Ce qu'on compte comme une inscription : une réponse, ou chaque ligne d'un
   * bloc répétable — un car de trente personnes n'est pas une inscription.
   */
  count_by: 'submission' | 'participant';
  /** Le bloc répétable compté quand `count_by` vaut `participant`. */
  participant_field_id?: string;
  registration_label?: string;
  tiers: PriceTier[];
  /** Passé le dernier seuil : garder le dernier tarif, ou fermer les inscriptions. */
  after_last: 'keep' | 'close';
}

/** Réglages monétaires d'un projet, hérités par tous ses formulaires. */
export interface ProjectPricing {
  currency: string;
  currency_position: 'before' | 'after';
  vat_enabled: boolean;
  vat_rate: number;
}

export const DEFAULT_PROJECT_PRICING: ProjectPricing = {
  // Papyrus est utilisé depuis Port-Louis : la roupie mauricienne est le défaut
  // qui épargne un réglage à la quasi-totalité des projets.
  currency: 'MUR',
  currency_position: 'before',
  vat_enabled: false,
  vat_rate: 15
};

export interface PricingConfig {
  enabled: boolean;
  /** Surchargent les réglages du projet quand ils sont renseignés. */
  currency?: string;
  currency_position?: 'before' | 'after';
  vat_enabled?: boolean;
  vat_rate?: number;
  vat_label?: string;
  subtotal_label?: string;
  total_label?: string;
  discount_enabled?: boolean;
  discount_label?: string;
  discount_code_label?: string;
  discounts?: DiscountCode[];
  tiered?: TieredPricing;
}

/** Réglages de tarification propres à un champ. */
export interface FieldPricing {
  /** `number` et `currency` : la valeur saisie s'ajoute au sous-total. */
  count_in_total?: boolean;
  /**
   * Choix unique et choix multiple : un compteur apparaît sous chaque option
   * retenue, et son prix est multiplié par la quantité. « Trois tables de six »
   * est une réponse, pas trois réponses.
   */
  quantity?: { enabled: boolean; min: number; max: number };
}

/**
 * Une ligne du détail figé à l'envoi.
 *
 * mooove-invoice ne conservait que le sous-total, la TVA et le total. Six mois
 * plus tard, avec des prix modifiés entre-temps, plus rien ne permettait
 * d'expliquer une facture : il aurait fallu relire un formulaire qui n'était
 * plus le même. L'instantané se suffit donc à lui-même.
 */
export interface PricingLine {
  /** Champ d'origine — vide pour la ligne d'inscription des tarifs dégressifs. */
  field_id?: string;
  label: string;
  /** Précision affichée sous le libellé : l'option retenue, le palier appliqué. */
  detail?: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

/** Totaux figés au moment de l'envoi — ils ne bougent plus jamais. */
export interface TotalsSnapshot {
  currency: string;
  currency_position: 'before' | 'after';
  lines: PricingLine[];
  subtotal: number;
  discount: number;
  discount_percent: number;
  discount_code: string;
  vat: number;
  vat_rate: number;
  total: number;
  subtotal_label: string;
  discount_label: string;
  vat_label: string;
  total_label: string;
  /** Renseigné quand un tarif dégressif s'applique. */
  registration?: {
    label: string;
    units: number;
    unit_price: number;
    amount: number;
    tier_label: string;
  };
}

/**
 * Clé réservée du code de réduction dans les réponses.
 *
 * Ce n'est pas une question du formulaire, donc pas un champ : la saisie vit
 * dans le bloc des totaux. Elle voyage néanmoins avec les réponses pour que
 * l'enregistrement automatique et la reprise d'une réponse en cours la
 * retrouvent. `/api/submit/[slug]` l'autorise explicitement, sans quoi son
 * filtre — qui n'accepte que les clés correspondant à un champ — l'écarterait.
 */
export const DISCOUNT_CODE_KEY = '__discount_code';

export type BackgroundType = 'color' | 'gradient' | 'image' | 'preset';
export type BannerFit = 'cover' | 'contain';
export type BannerPosition = 'top' | 'center' | 'bottom';

export interface FormTheme {
  // Legacy / résolu
  bg: string;
  accent: string;
  font: string;
  // Style des questions appliqué globalement (overridable par champ)
  field_style?: FieldStyle;
  // Bannière
  banner_url?: string | null;
  banner_fit?: BannerFit;
  banner_position?: BannerPosition;
  banner_position_x?: number; // Position horizontale (0-100)
  banner_position_y?: number; // Position verticale (0-100)
  banner_scale?: number; // Facteur de zoom (0.5-3, défaut: 1)
  banner_full_width?: boolean; // Bannière sur toute la largeur du viewport
  // Arrière-plan détaillé
  bg_type?: BackgroundType;
  bg_color?: string;
  bg_gradient_from?: string;
  bg_gradient_to?: string;
  bg_gradient_angle?: number; // degrés
  bg_image_url?: string;
  bg_image_opacity?: number; // 0-100 (opacité de l'overlay parchemin par-dessus l'image)
  bg_preset?: string;
  // Couleur des blocs (cartes des questions)
  field_bg_color?: string;
  field_border_color?: string;
  // Logo (position fixe style LinkedIn)
  logo_url?: string | null;
  logo_shape?: 'circle' | 'rounded'; // Forme du logo : rond ou carré
  logo_size?: number; // Zoom du logo (0.5-3, défaut: 1)
  // Divers
  text_color?: string;
  button_style?: 'filled' | 'outline' | 'ghost';
  dark_mode?: boolean;
  fields_icons_enabled?: boolean;
  /** Libellé personnalisé du score (défaut: "Score") */
  score_label?: string;
  /** Description personnalisée du score (défaut: "Basé sur vos réponses à ce formulaire") */
  score_description?: string;
  /** Niveaux de maturité personnalisés */
  score_levels?: ScoreLevel[];
  /** Configuration du tableau de bord des graphiques */
  dashboard_config?: DashboardConfig;
}

export interface ChartLayoutItem {
  field_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardConfig {
  chart_order?: string[];
  chart_titles?: Record<string, string>;
  deleted_charts?: string[];
  chart_matrix_types?: Record<string, 'heatmap' | 'bar'>;
  chart_layout?: ChartLayoutItem[];
}

export interface ScoreLevel {
  minPercent: number;
  title: string;
  description: string;
  color: 'green' | 'blue' | 'orange' | 'red';
}

// ============================================================================
// Réglages par formulaire — onglet « Paramètres »
//
// Deux objets distincts, stockés dans deux colonnes distinctes :
//  · `FormSettings` est exposée à la vue publique (le répondant a besoin de
//    savoir s'il y a une barre de progression, vers où rediriger, etc.) ;
//  · `NotificationSettings` ne l'est jamais — elle contient des adresses email
//    et le corps des messages envoyés.
// ============================================================================

export type EmbedMode = 'standard' | 'popup' | 'fullpage';
export type PopupTrigger = 'click' | 'time' | 'scroll' | 'exit';

export interface EmbedSettings {
  mode: EmbedMode;
  /** Hauteur de l'iframe en pixels, ignorée si `dynamic_height` est actif. */
  height: number;
  /** L'iframe annonce sa hauteur au parent, qui la suit. Nécessite embed.js. */
  dynamic_height: boolean;
  hide_title: boolean;
  align_left: boolean;
  transparent_background: boolean;
  /** Émet les évènements du formulaire vers la page hôte (dataLayer + CustomEvent). */
  track_events: boolean;
  // Mode popup uniquement
  popup_trigger?: PopupTrigger;
  /** Délai en secondes pour le déclencheur `time`. */
  popup_delay?: number;
  /** Pourcentage de défilement pour le déclencheur `scroll`. */
  popup_scroll_percent?: number;
  popup_button_label?: string;
  /** Ouvre le popup une seule fois par visiteur (localStorage). */
  popup_once?: boolean;
}

export interface FormSettings {
  // --- Général ---
  /** Langue de l'interface vue par le répondant (boutons, erreurs). */
  respondent_language?: string;
  redirect_on_completion?: boolean;
  redirect_url?: string;
  progress_bar?: boolean;
  /** Enregistre les réponses au fil de la saisie, avant l'envoi définitif. */
  partial_submissions?: boolean;
  data_retention_enabled?: boolean;
  data_retention_days?: number;

  // --- Accès ---
  max_submissions_enabled?: boolean;
  max_submissions?: number;
  closed_message_enabled?: boolean;
  closed_message?: string;
  /** Empêche deux réponses portant la même valeur sur `duplicate_field_id`. */
  prevent_duplicates?: boolean;
  duplicate_field_id?: string;

  // --- Comportement ---
  /** Passe à la page suivante dès qu'une question à choix unique est répondue. */
  auto_jump?: boolean;

  /** Dernière configuration d'intégration utilisée — mémorisée pour l'interface. */
  embed?: EmbedSettings;

  /**
   * Slug du modèle dont ce formulaire est issu.
   *
   * Chaîne libre, et non `template_origin_id` : cette colonne-là est un
   * `uuid references papyrus.forms(id)`, alors qu'un modèle de catalogue n'est
   * pas une ligne en base et porte un identifiant textuel.
   */
  template_origin_slug?: string;
}

export interface SelfNotificationSettings {
  enabled: boolean;
  /** Destinataires. Vide = le créateur du formulaire. */
  to: string[];
  subject: string;
  body: string;
}

export interface RespondentNotificationSettings {
  enabled: boolean;
  from_name: string;
  reply_to: string;
  /** Champ email du formulaire servant d'adresse de destination. */
  to_field_id: string;
  subject: string;
  body: string;
  /** Joint un PDF récapitulatif des réponses. */
  attach_pdf: boolean;
}

export interface NotificationSettings {
  self?: SelfNotificationSettings;
  respondent?: RespondentNotificationSettings;
}

// ============================================================================
// E-mails de confirmation (phase 4)
//
// Deux mécanismes coexistent, et il faut savoir lequel parle :
//
//  · `NotificationSettings` ci-dessus est l'héritage de Papyrus : un accusé de
//    réception en texte brut, une seule version, aucune condition.
//  · `EmailConfig` est ce que la phase 4 apporte : plusieurs messages, choisis
//    selon les réponses, bilingues, avec le bon de commande en pièce jointe.
//
// Quand `EmailConfig.enabled` vaut vrai, il REMPLACE l'accusé de réception au
// répondant — la notification interne, elle, continue de partir. Sans cette
// règle d'arbitrage, un auteur qui découvre le nouvel onglet sans penser à
// l'ancien enverrait deux e-mails à chaque inscrit.
// ============================================================================

/** Un message : ce qui part réellement dans la boîte du répondant. */
export interface EmailMessage {
  /** Objet du message. Accepte les jetons `{{…}}`, rendus en texte brut. */
  subject: MultilingualText;
  /** Corps HTML. Accepte les jetons `{{…}}`, dont les valeurs sont échappées. */
  body: MultilingualText;
  /**
   * Joint le bon de commande en PDF.
   *
   * Non renseigné : la valeur du formulaire s'applique. C'est le seul réglage
   * qu'une règle peut surcharger — un message de refus n'a pas à porter un bon
   * de commande, alors que l'objet et le corps changent forcément.
   */
  attach_pdf?: boolean;
}

/**
 * Un message conditionnel.
 *
 * Les règles sont évaluées de haut en bas et la première qui correspond gagne :
 * l'ordre est donc une décision de l'auteur, pas un détail d'affichage. Une
 * règle sans condition est ignorée — elle capterait tout et masquerait
 * silencieusement celles qui la suivent.
 */
export interface EmailRule {
  id: string;
  /** Nom interne, jamais envoyé — « Tarif étudiant », « Refus ». */
  label: string;
  /** Mêmes conditions qu'un verrou de visibilité : `lib/visibility` les évalue. */
  when?: VisibilityRule;
  message: EmailMessage;
}

export interface EmailConfig {
  enabled: boolean;
  /**
   * Champ e-mail servant d'adresse de destination.
   * Vide : le premier champ e-mail rempli et visible.
   */
  to_field_id?: string;
  /** Nom d'expéditeur affiché. L'adresse, elle, est celle de l'instance. */
  from_name?: string;
  reply_to?: string;
  cc?: string;
  bcc?: string;
  /** Joint le bon de commande en PDF, sauf surcharge par une règle. */
  attach_pdf?: boolean;
  /** Message envoyé quand aucune règle ne correspond. */
  default_message: EmailMessage;
  rules?: EmailRule[];
}

export function emptyEmailMessage(): EmailMessage {
  return { subject: { fr: '' }, body: { fr: '' } };
}

export const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  enabled: false,
  attach_pdf: true,
  default_message: { subject: { fr: '' }, body: { fr: '' } }
};

/**
 * Écran de remerciement.
 *
 * Il vit sur le formulaire et non sur le projet : c'est le dernier écran d'un
 * parcours précis, et il peut citer les réponses qu'on vient d'y donner.
 */
export interface ConfirmationConfig {
  title?: MultilingualText;
  /** Accepte les jetons `{{…}}`. */
  message?: MultilingualText;
  /** Affiche le numéro de bon de commande. Sans objet si le projet n'en attribue pas. */
  show_reference?: boolean;
  reference_label?: MultilingualText;
  /** Petite mention sous le numéro — « Un e-mail vient de vous être envoyé ». */
  email_note?: MultilingualText;
  /** Bouton facultatif : sans URL, aucun bouton n'est affiché. */
  button_label?: MultilingualText;
  button_url?: string;
}

/**
 * Numérotation des bons de commande, portée par le projet.
 *
 * `next` n'est jamais modifié depuis le navigateur pendant une inscription :
 * c'est la fonction SQL `assign_invoice_number` qui l'incrémente, sous verrou de
 * ligne. Le réglage ci-dessous ne sert qu'à choisir le point de départ et la
 * forme du numéro.
 */
export interface ProjectInvoicing {
  prefix: string;
  /** Prochain numéro à attribuer. */
  next: number;
  /** Nombre de chiffres — `4` donne `CMD-0001`. */
  pad: number;
}

export const DEFAULT_PROJECT_INVOICING: ProjectInvoicing = {
  prefix: 'CMD',
  next: 1,
  pad: 4
};

export type IntegrationProvider = 'google_sheets';

/**
 * Une règle de répartition : « quand la réponse vaut ceci, écrire dans cet
 * onglet ».
 *
 * L'onglet est désigné par son NOM et non par un identifiant : c'est ce que
 * l'utilisateur lit dans Google Sheets, et un onglet absent est créé plutôt que
 * de faire échouer l'écriture.
 */
export interface SheetSplitRule {
  /** Valeur de la question de répartition — l'identifiant d'option, pas son libellé. */
  value: string;
  /** Nom de l'onglet de destination. */
  tab: string;
}

export interface GoogleSheetsConfig {
  spreadsheet_id: string;
  spreadsheet_name?: string;
  spreadsheet_url?: string;
  sheet_title: string;
  /** Ajoute les colonnes date d'envoi / langue / identifiant. */
  include_metadata?: boolean;
  /**
   * Question dont la réponse choisit l'onglet de destination.
   *
   * Vide : tout va dans `sheet_title`. Renseignée, chaque réponse part dans
   * l'onglet que `split_map` associe à sa valeur — et dans `sheet_title` quand
   * aucune règle ne correspond, plutôt que nulle part.
   */
  split_field_id?: string;
  split_map?: SheetSplitRule[];
}

export interface FormIntegration {
  id: string;
  form_id: string;
  provider: IntegrationProvider;
  config: GoogleSheetsConfig | Record<string, unknown>;
  is_active: boolean;
  last_synced_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface IntegrationEvent {
  id: string;
  integration_id: string;
  form_id: string;
  submission_id?: string | null;
  status: 'success' | 'error' | 'skipped';
  message?: string | null;
  created_at: string;
}

export type ProjectStatus = 'active' | 'archived';

/**
 * Modules activables d'un projet.
 *
 * Ils commandent les onglets visibles : un projet d'enquête n'a aucune raison
 * d'afficher une tarification. L'assistant de création les renseigne d'après les
 * réponses au questionnaire, et ils restent modifiables ensuite.
 */
export interface ProjectModules {
  pricing: boolean;
  partners: boolean;
  invoicing: boolean;
  email: boolean;
}

export const DEFAULT_PROJECT_MODULES: ProjectModules = {
  pricing: false,
  partners: false,
  invoicing: false,
  email: false
};

/**
 * Un projet regroupe plusieurs formulaires et porte ce qui leur est commun.
 *
 * Règle de répartition, valable pour tout le produit : une configuration qui
 * référence des champs appartient au formulaire ; tout le reste appartient au
 * projet. La tarification et les règles d'e-mail vivent donc sur le formulaire,
 * les partenaires et la numérotation des factures sur le projet.
 */
export interface Project {
  id: string;
  team_id: string;
  created_by?: string | null;
  name: string;
  description: string;
  status: ProjectStatus;
  languages: string[];
  default_language: string;
  theme: Partial<FormTheme>;
  modules: ProjectModules;
  /** Devise et TVA, héritées par tous les formulaires du projet. */
  pricing: ProjectPricing;
  /**
   * Numérotation des bons de commande.
   *
   * Sur le projet parce qu'une séquence appartient à un événement, pas à l'un
   * de ses formulaires : l'inscription en ligne et le bulletin papier saisi à
   * la main doivent tirer leurs numéros du même compteur.
   */
  invoicing: ProjectInvoicing;
  created_at: string;
  updated_at: string;
  /** Renseigné par les requêtes de liste — jamais une colonne. */
  form_count?: number;
}

/** Ce qu'un instantané fige : le formulaire, ses champs et sa logique. */
export interface FormSnapshot {
  form: Partial<Form>;
  fields: Field[];
  logic_rules: LogicRule[];
}

export type FormVersionKind = 'auto' | 'manual' | 'ai';

export interface FormVersion {
  id: string;
  form_id: string;
  snapshot: FormSnapshot;
  label: string;
  kind: FormVersionKind;
  created_by?: string | null;
  created_by_name: string;
  created_at: string;
}

export interface Form {
  id: string;
  team_id: string;
  /**
   * Projet auquel appartient le formulaire.
   *
   * Nul uniquement pour un modèle : un modèle ne vit dans aucun projet, il sert
   * à en peupler un. La contrainte `forms_project_required` fait respecter cette
   * règle en base.
   */
  project_id?: string | null;
  /** Alias historique de `team_id` — l'interface dit « espace de travail ». */
  workspace_id?: string;
  created_by?: string;
  title: string;
  slug: string;
  description?: string;
  display_mode: DisplayMode;
  status: FormStatus;
  is_template: boolean;
  template_origin_id?: string | null;
  /** Périmètre de visibilité quand le form est un modèle (`is_template = true`). */
  scope?: FormScope;
  /** Catégorie d'un modèle (« Sondage », « RH », « Événement »…) — utilisée pour le tri. */
  template_category?: string;
  /** Brève description d'un modèle — affichée sur la carte. */
  template_description?: string;
  /** Icône Lucide (nom) à afficher sur la carte du modèle. */
  template_icon?: string;
  theme: FormTheme;
  access_type: AccessType;
  access_password?: string | null;
  languages: string[];
  default_language: string;
  /** Les sections du formulaire, triées par `section_order`. */
  sections?: Section[];
  /**
   * Tous les champs du formulaire, à plat et dans l'ordre de lecture
   * (sections puis champs). Conservé parce que la quasi-totalité du produit
   * raisonne sur une liste ordonnée ; `sections` porte le découpage.
   */
  fields?: Field[];
  logic_rules?: LogicRule[];
  /** Si vrai, l'avancée du répondant est sauvegardée en localStorage et proposée au rechargement. */
  save_and_resume?: boolean;
  /** Si vrai, un même email ne peut soumettre qu'une seule fois (nécessite un champ email). */
  unique_email?: boolean;
  /** Si vrai, les nouveaux champs créés sont requis par défaut. */
  require_all_by_default?: boolean;
  /** Si vrai, active le système de scoring avec attribution de points aux réponses. */
  scoring_enabled?: boolean;
  /** Si vrai, affiche le score final au répondant (nécessite scoring_enabled). */
  show_score_to_respondent?: boolean;
  /** Réglages de l'onglet « Paramètres » — exposés à la vue publique. */
  settings?: FormSettings;
  /** Notifications email — jamais exposées à la vue publique. */
  notification_settings?: NotificationSettings;
  /** Tarification du formulaire — cf. `PricingConfig`. */
  pricing_config?: PricingConfig;
  /** E-mails de confirmation — jamais exposés à la vue publique. */
  email_config?: EmailConfig;
  /** Écran de remerciement — exposé à la vue publique, lui. */
  confirmation_config?: ConfirmationConfig;
  /**
   * Réglages monétaires du projet, joints à la lecture.
   *
   * Ce n'est pas une colonne : `resolvePricing` s'en sert pour combler ce que le
   * formulaire ne surcharge pas. Résoudre à la lecture plutôt qu'à l'écriture
   * évite qu'un changement de devise au niveau du projet laisse derrière lui des
   * formulaires figés sur l'ancienne.
   */
  project_pricing?: ProjectPricing;
  /**
   * Nombre de réponses déjà enregistrées.
   *
   * Pas une colonne non plus : la vue publique le calcule, et **uniquement** si
   * le formulaire applique un tarif dégressif. Un tarif early bird annonce de
   * lui-même « il reste N places » ; le compte des réponses d'un sondage ne
   * regarde personne.
   */
  registered_count?: number | null;
  published_at?: string | null;
  closes_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  plan: 'free' | 'pro' | 'team';
  created_at: string;
}

export interface TeamMember {
  user_id: string;
  team_id: string;
  role: TeamRole;
  joined_at: string;
}

export type InvitationType = 'email' | 'link';
export type InvitationStatus = 'pending' | 'accepted' | 'expired';

export interface TeamInvitation {
  id: string;
  team_id: string;
  invited_by?: string;
  invitation_type: InvitationType;
  email?: string; // pour invitations par email
  invite_token?: string; // pour invitations par lien
  role: TeamRole;
  status: InvitationStatus;
  expires_at?: string;
  accepted_at?: string;
  accepted_by?: string;
  created_at: string;
}

export interface TeamMemberWithProfile {
  user_id: string;
  team_id: string;
  role: TeamRole;
  joined_at: string;
  name?: string;
  email?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  created_at: string;
  updated_at: string;
}

export type DestinationType = 'supabase' | 'airtable' | 'google_sheets';

export interface FormDestination {
  id: string;
  form_id: string;
  type: DestinationType;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export type ActionType = 'webhook' | 'rest_api' | 'email';

export interface FormAction {
  id: string;
  form_id: string;
  type: ActionType;
  name: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export type ChartType = 'bar' | 'pie' | 'line' | 'number' | 'word_cloud' | 'table';

export interface Chart {
  id: string;
  form_id: string;
  field_id?: string;
  type: ChartType;
  title?: string;
  config: Record<string, unknown>;
  ai_generated: boolean;
  display_order: number;
  created_at: string;
}

export interface FieldTranslation {
  id: string;
  form_id: string;
  language: string;
  translations: Record<string, { label?: string; description?: string; options?: Record<string, string> }>;
  ai_generated: boolean;
  manually_reviewed: boolean;
  created_at: string;
}

/**
 * Où en est une réponse.
 *
 * Quatre états, repris de mooove-invoice parce qu'ils décrivent ce que font
 * réellement les équipes. `void` n'efface rien : la réponse reste lisible, mais
 * elle cesse de compter — ni dans le quota du formulaire, ni dans le palier d'un
 * tarif dégressif. Annuler une inscription doit libérer la place qu'elle
 * occupait, sinon l'annulation ne veut rien dire.
 */
export type SubmissionStatus = 'submitted' | 'reviewed' | 'paid' | 'void';

export const SUBMISSION_STATUSES: SubmissionStatus[] = [
  'submitted',
  'reviewed',
  'paid',
  'void'
];

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  submitted: 'Reçue',
  reviewed: 'Vérifiée',
  paid: 'Payée',
  void: 'Annulée'
};

export interface Submission {
  id: string;
  form_id: string;
  responses?: Record<string, unknown>;
  respondent_language: string;
  respondent_email?: string | null;
  ip_hash?: string;
  user_agent?: string;
  /** Ébauche enregistrée avant l'envoi définitif (option « réponses partielles »). */
  is_partial?: boolean;
  session_id?: string | null;
  /** Totaux figés à l'envoi — jamais recalculés ensuite. */
  pricing?: TotalsSnapshot | null;
  /** Où en est cette réponse — cf. `SUBMISSION_STATUSES`. */
  status?: SubmissionStatus;
  status_updated_at?: string | null;
  /**
   * Numéro du bon de commande, tiré de la séquence du projet.
   * Nul quand le module facturation est éteint : un sondage n'en a pas.
   */
  invoice_number?: string | null;
  /** Horodatage de l'e-mail de confirmation parti. */
  email_sent_at?: string | null;
  /** Motif du dernier échec d'envoi, pour que l'auteur puisse le voir. */
  email_error?: string | null;
  completed_at: string;
  actions_triggered: unknown[];
}

export interface FormStats {
  total_responses: number;
  completion_rate: number;
  avg_time_seconds: number;
  responses_by_day: { date: string; count: number }[];
}

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type WorkspaceScope = 'personal' | 'team';

export interface WorkspaceMember {
  user_id: string;
  workspace_id: string;
  role: WorkspaceRole;
  joined_at: string;
  name?: string;
  email?: string;
}

export interface Workspace {
  id: string;
  name: string;
  scope: WorkspaceScope;
  is_deletable: boolean;
  created_by: string;
  created_at: string;
  members?: WorkspaceMember[];
  form_count?: number;
}

