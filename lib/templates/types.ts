import type { Field, FieldType, FormSettings, LogicRule, MultilingualText } from '@/types';

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

/**
 * Types de champ acceptés dans un fichier de modèle : ceux de l'application,
 * plus `section_break`.
 *
 * L'application n'a plus de type `section_break` — une section y est un objet.
 * Le catalogue le conserve comme **convention d'écriture** : dans un fichier de
 * contenu, une rupture plantée dans la liste reste la façon la plus lisible
 * d'exprimer un découpage en pages, et cela évite de réécrire les 51 fichiers.
 * `to-form.ts` convertit ces ruptures en sections réelles à l'import.
 */
export type TemplateFieldType = FieldType | 'section_break';

/**
 * Un champ de catalogue : un `Field` sans les métadonnées liées au formulaire.
 * `section_id` en est absent — c'est l'import qui rattache le champ à la section
 * qu'il aura créée.
 */
export type TemplateField = Omit<
  Field,
  'form_id' | 'field_order' | 'created_at' | 'section_id' | 'type'
> & {
  type: TemplateFieldType;
};

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
