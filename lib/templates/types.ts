import type { Field, FormSettings, LogicRule, MultilingualText } from '@/types';

/**
 * Types du catalogue de modèles.
 *
 * `CLAUDE.md` fixe `types/` comme source de vérité des types de l'application.
 * Ceux-ci font exception : ils décrivent le **format d'un fichier de contenu**
 * versionné dans le dépôt, pas le modèle de données de Papyrus. Ils vivent donc
 * à côté du catalogue qu'ils décrivent.
 */

/** Faisabilité d'un modèle vis-à-vis des types de champs disponibles. */
export type TemplateFeasibility = 'ready' | 'degraded' | 'blocked';

/** Un champ de catalogue : un `Field` sans les métadonnées liées au formulaire. */
export type TemplateField = Omit<Field, 'form_id' | 'field_order' | 'created_at'>;

/**
 * Une règle de catalogue : une `LogicRule` sans `form_id`.
 * `target_field_id` est explicitement nullable : les règles `end_form` portent
 * `null`, ce que `LogicRule['target_field_id']` (optionnel, non nullable) ne
 * couvre pas.
 */
export type TemplateLogicRule = Omit<LogicRule, 'form_id' | 'target_field_id'> & {
  target_field_id?: string | null;
};

export interface TemplateDefinition {
  /** `tpl-mooove-<slug>` — identifiant textuel, jamais un uuid. */
  id: string;
  slug: string;
  category: string;
  /** Nom d'icône Lucide, résolu via `components/templates/template-icons.ts`. */
  icon: string;
  display_mode: 'scroll' | 'sections' | 'typeform';
  feasibility: TemplateFeasibility;
  feasibility_note: MultilingualText;
  title: MultilingualText;
  description: MultilingualText;
  template_description: MultilingualText;
  scoring_enabled: boolean;
  show_score_to_respondent: boolean;
  settings: FormSettings;
  fields: TemplateField[];
  logic_rules: TemplateLogicRule[];
}

/** Entrée d'index — tout ce dont la galerie a besoin sans charger le modèle complet. */
export interface TemplateIndexEntry {
  id: string;
  slug: string;
  category: string;
  icon: string;
  display_mode: TemplateDefinition['display_mode'];
  feasibility: TemplateFeasibility;
  title: MultilingualText;
  template_description: MultilingualText;
  scoring_enabled: boolean;
  field_count: number;
  page_count: number;
  rule_count: number;
  has_matrix: boolean;
  has_media: boolean;
  has_file: boolean;
}
