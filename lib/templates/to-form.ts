import type { Field, Form, LogicRule, MultilingualText, Section } from '@/types';
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
    ...splitIntoSections(def),
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

/**
 * Convertit la liste plate d'un fichier de modèle en sections réelles.
 *
 * Le catalogue exprime encore un découpage par `section_break` — c'est la façon
 * la plus lisible de l'écrire dans un fichier de contenu. L'application, elle,
 * n'a plus ce type : chaque rupture ouvre ici une section qui hérite de son
 * libellé et de sa description, et les champs suivants lui sont rattachés. Les
 * champs situés avant toute rupture forment une section d'ouverture sans titre.
 *
 * Les identifiants sont dérivés de celui du modèle et restent donc stables d'un
 * aperçu à l'autre. `importForm` leur substituera de vrais uuid au moment
 * d'écrire en base.
 */
function splitIntoSections(def: TemplateDefinition): Pick<Form, 'sections' | 'fields' | 'logic_rules'> {
  const sections: Section[] = [];
  const fields: Field[] = [];
  /** Ancien identifiant de rupture → identifiant de la section créée. */
  const breakToSection = new Map<string, string>();

  let current: Section | null = null;
  let fieldOrder = 0;

  const openSection = (title: MultilingualText, description: MultilingualText): Section => {
    const section: Section = {
      id: `${def.id}-section-${sections.length}`,
      form_id: def.id,
      title,
      description,
      section_order: sections.length,
      fields: []
    };
    sections.push(section);
    fieldOrder = 0;
    return section;
  };

  for (const templateField of def.fields) {
    if (templateField.type === 'section_break') {
      current = openSection(templateField.label, templateField.description);
      breakToSection.set(templateField.id, current.id);
      continue;
    }

    if (!current) current = openSection({ fr: '' }, { fr: '' });

    const field = {
      ...templateField,
      form_id: def.id,
      section_id: current.id,
      field_order: fieldOrder++
    } as Field;

    fields.push(field);
    current.fields?.push(field);
  }

  // Un modèle sans aucun champ doit tout de même ouvrir une section : le
  // constructeur y déposera la première question.
  if (sections.length === 0) openSection({ fr: '' }, { fr: '' });

  const logicRules = def.logic_rules.map((rule) => {
    const targetSection = rule.target_field_id
      ? breakToSection.get(rule.target_field_id)
      : undefined;

    // Une règle « aller à » qui visait une rupture vise désormais la section.
    return {
      ...rule,
      form_id: def.id,
      target_field_id: targetSection ? null : rule.target_field_id,
      target_section_id: targetSection ?? null
    } as LogicRule;
  });

  return { sections, fields, logic_rules: logicRules };
}
