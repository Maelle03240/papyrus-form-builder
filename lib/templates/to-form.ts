import type { Field, Form, LogicRule, MultilingualText } from '@/types';
import type { TemplateDefinition } from './types';

/**
 * Conversion d'une définition de catalogue en `Form`.
 *
 * ⚠️ `Form.title`, `Form.description`, `Form.template_description` et
 * `Form.template_category` sont des `string`, pas des `MultilingualText` : seuls
 * les libellés de **champs** sont multilingues. La conversion doit donc résoudre
 * une langue pour ces quatre valeurs, et seulement pour elles — les champs
 * gardent leurs deux langues, si bien qu'un formulaire créé depuis un modèle
 * reste bilingue.
 *
 * Ce module est appelé depuis le navigateur : il ne porte volontairement pas
 * `import 'server-only'`. C'est `generated.ts`, qui embarque les 51 fichiers,
 * qui porte ce garde-fou.
 */

const ml = (m: MultilingualText | undefined, lang: string): string =>
  (m ? (m[lang] ?? m.fr ?? '') : '');

export function templateToForm(def: TemplateDefinition, lang: 'fr' | 'en' = 'fr'): Form {
  const now = new Date().toISOString();

  return {
    id: def.id,
    team_id: '', // renseigné par importForm à partir de l'espace actif
    title: ml(def.title, lang),
    slug: def.slug,
    description: ml(def.description, lang),
    display_mode: def.display_mode,
    status: 'published',
    is_template: true,
    template_origin_id: null,
    scope: 'global',
    template_category: def.category,
    template_description: ml(def.template_description, lang),
    template_icon: def.icon,
    theme: {
      bg: '#EFF9FE',
      accent: '#052139',
      font: 'Aktiv Grotesk',
      bg_type: 'preset',
      bg_preset: 'ice'
    },
    access_type: 'public',
    languages: ['fr', 'en'],
    default_language: lang,
    fields: def.fields.map((f, i) => ({ ...f, form_id: def.id, field_order: i }) as Field),
    logic_rules: def.logic_rules.map((r) => ({ ...r, form_id: def.id }) as LogicRule),
    save_and_resume: true,
    unique_email: false,
    scoring_enabled: def.scoring_enabled,
    show_score_to_respondent: def.show_score_to_respondent,
    settings: def.settings,
    published_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now
  };
}
