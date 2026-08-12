/**
 * Valide le catalogue de modèles. Sort en échec au premier problème trouvé.
 *
 * Usage : npm run templates:check
 *
 * Les modèles sont du contenu, pas du code : rien dans le typage TypeScript
 * n'empêche d'écrire un `type` inexistant, une condition qui pointe vers un
 * champ supprimé, ou un libellé sans traduction anglaise. Ce script est le
 * garde-fou, et il est fait pour protéger les ajouts futurs autant que l'existant.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIMITS } from '../lib/constants/limits';
import type { TemplateDefinition, TemplateIndexEntry } from '../lib/templates/types';
import type { FieldType, MultilingualText } from '../types';

const DIR = join(process.cwd(), 'lib/templates/catalog');

/** Les 18 types réellement supportés. Toute addition passe d'abord par la checklist Phase 4. */
const ALLOWED_TYPES: FieldType[] = [
  'short_text', 'long_text', 'email', 'phone', 'number', 'url',
  'single_choice', 'multiple_choice', 'dropdown', 'rating', 'nps',
  'date', 'file', 'section_break', 'statement', 'image', 'video', 'matrix'
];

/** Clés autorisées dans `FieldValidation` — miroir de types/index.ts. */
const ALLOWED_VALIDATION_KEYS = new Set([
  'min', 'max', 'pattern', 'accept', 'default_country',
  'creator_mode_enabled', 'respondent_mode_enabled', 'media_url', 'max_file_size_mb',
  'alignment', 'image_width', 'image_height', 'show_title', 'original_width',
  'original_height', 'ratio_locked', 'image_position_x', 'image_position_y',
  'response_type', 'max_decimals', 'unit', 'user_can_choose_unit',
  'banner_fit', 'banner_position_x', 'banner_position_y', 'full_width',
  'logo_size', 'logo_position_x', 'logo_position_y', 'logo_shape',
  'matrix_mode', 'has_other', 'other_label', 'options_columns', 'display_style',
  'has_subfields', 'randomize_options', 'selection_min', 'selection_max',
  'nps_left_label', 'nps_right_label'
]);

const CHOICE_TYPES = new Set(['single_choice', 'multiple_choice', 'dropdown']);

const errors: string[] = [];
const fail = (slug: string, message: string) => errors.push(`  [${slug}] ${message}`);

const bilingual = (m: MultilingualText | undefined) =>
  Boolean(m && typeof m.fr === 'string' && typeof m.en === 'string');

// --- 13. _order.json et le dossier doivent être synchrones -------------------
const { order } = JSON.parse(readFileSync(join(DIR, '_order.json'), 'utf8')) as { order: string[] };
const onDisk = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== '_order.json')
  .map((f) => f.replace(/\.json$/, ''));

for (const slug of order) if (!onDisk.includes(slug)) errors.push(`  [_order] listé sans fichier : ${slug}`);
for (const slug of onDisk) if (!order.includes(slug)) errors.push(`  [_order] fichier non listé : ${slug}`);

const defs: TemplateDefinition[] = order
  .filter((slug) => onDisk.includes(slug))
  .map((slug) => JSON.parse(readFileSync(join(DIR, `${slug}.json`), 'utf8')) as TemplateDefinition);

for (const t of defs) {
  const slug = t.slug;
  const fieldIds = new Set<string>();
  const optionIds = new Set<string>();

  if (t.slug !== order.find((s) => s === t.slug)) fail(slug, 'slug absent de _order.json');

  // --- 12. une faisabilité dégradée doit être expliquée ---------------------
  if (t.feasibility !== 'ready' && !t.feasibility_note?.fr?.trim()) {
    fail(slug, `feasibility '${t.feasibility}' sans feasibility_note.fr`);
  }

  // --- 6 / 7. cohérence entre mode d'affichage et sauts de section ----------
  const breaks = t.fields.filter((f) => f.type === 'section_break');
  if (t.display_mode === 'sections') {
    if (t.fields[0]?.type !== 'section_break') {
      fail(slug, "display_mode 'sections' mais le premier champ n'est pas un section_break");
    }
  } else if (breaks.length > 0) {
    fail(slug, `display_mode '${t.display_mode}' mais ${breaks.length} section_break présent(s)`);
  }

  for (const f of t.fields) {
    // --- 1. type autorisé --------------------------------------------------
    if (!ALLOWED_TYPES.includes(f.type)) fail(slug, `type inconnu : ${f.type} (${f.id})`);

    // --- 3. identifiants uniques et préfixés par le slug -------------------
    if (fieldIds.has(f.id)) fail(slug, `identifiant de champ dupliqué : ${f.id}`);
    fieldIds.add(f.id);
    if (!f.id.startsWith(slug)) fail(slug, `identifiant de champ non préfixé : ${f.id}`);

    // --- 2. clés de validation connues -------------------------------------
    for (const key of Object.keys(f.validation ?? {})) {
      if (!ALLOWED_VALIDATION_KEYS.has(key)) fail(slug, `clé de validation inconnue : ${key} (${f.id})`);
    }

    // --- 4. libellés bilingues ---------------------------------------------
    if (!bilingual(f.label)) fail(slug, `label sans fr+en : ${f.id}`);
    if (!bilingual(f.description)) fail(slug, `description sans fr+en : ${f.id}`);
    if (!bilingual(f.placeholder)) fail(slug, `placeholder sans fr+en : ${f.id}`);

    // --- 5. limites --------------------------------------------------------
    if ((f.label?.fr?.length ?? 0) > LIMITS.FIELD_LABEL_MAX) {
      fail(slug, `libellé > ${LIMITS.FIELD_LABEL_MAX} caractères : ${f.id}`);
    }

    const options = f.options ?? [];
    const max =
      f.type === 'dropdown' ? LIMITS.DROPDOWN_OPTIONS_MAX
      : f.type === 'single_choice' ? LIMITS.SINGLE_CHOICE_OPTIONS_MAX
      : f.type === 'multiple_choice' ? LIMITS.MULTI_CHOICE_OPTIONS_MAX
      : f.type === 'matrix' ? LIMITS.MATRIX_COLS_MAX
      : Infinity;
    if (options.length > max) fail(slug, `${f.type} : ${options.length} options > ${max} (${f.id})`);

    if (f.type === 'matrix' && (f.rows?.length ?? 0) > LIMITS.MATRIX_ROWS_MAX) {
      fail(slug, `matrice : ${f.rows?.length} lignes > ${LIMITS.MATRIX_ROWS_MAX} (${f.id})`);
    }

    for (const o of [...options, ...(f.rows ?? [])]) {
      if (optionIds.has(o.id)) fail(slug, `identifiant d'option dupliqué : ${o.id}`);
      optionIds.add(o.id);
      if (!o.id.startsWith(slug)) fail(slug, `identifiant d'option non préfixé : ${o.id}`);
      if (!bilingual(o.label)) fail(slug, `option sans fr+en : ${o.id}`);
      if ((o.label?.fr?.length ?? 0) > LIMITS.OPTION_LABEL_MAX) {
        fail(slug, `libellé d'option > ${LIMITS.OPTION_LABEL_MAX} caractères : ${o.id}`);
      }

      // --- 10. points seulement sur un formulaire noté ---------------------
      if (o.points !== undefined && !t.scoring_enabled) {
        fail(slug, `points présents alors que scoring_enabled = false : ${o.id}`);
      }
    }
  }

  // --- 11. les demi-largeurs vont par paires adjacentes ---------------------
  const widths = t.fields.map((f) => f.layout_width ?? 'full');
  for (let i = 0; i < widths.length; i++) {
    if (widths[i] !== 'half') continue;
    const pairedBefore = i > 0 && widths[i - 1] === 'half';
    const pairedAfter = i < widths.length - 1 && widths[i + 1] === 'half';
    if (!pairedBefore && !pairedAfter) {
      fail(slug, `champ 'half' isolé, sans voisin 'half' : ${t.fields[i].id}`);
    }
  }

  // --- 8 / 9. les règles pointent vers des champs et des options réels ------
  for (const rule of t.logic_rules) {
    if (rule.target_field_id && !fieldIds.has(rule.target_field_id)) {
      fail(slug, `règle ${rule.id} : target_field_id inconnu (${rule.target_field_id})`);
    }
    for (const c of rule.conditions ?? []) {
      if (!fieldIds.has(c.source_field_id)) {
        fail(slug, `règle ${rule.id} : source_field_id inconnu (${c.source_field_id})`);
        continue;
      }
      const source = t.fields.find((f) => f.id === c.source_field_id);
      if (source && CHOICE_TYPES.has(source.type) && !optionIds.has(c.value)) {
        fail(
          slug,
          `règle ${rule.id} : la condition sur un ${source.type} doit porter un option_id, pas « ${c.value} »`
        );
      }
    }
  }
}

// --- 14. index.json doit refléter les fichiers -------------------------------
const expected: TemplateIndexEntry[] = defs.map((t) => ({
  id: t.id, slug: t.slug, category: t.category, icon: t.icon,
  display_mode: t.display_mode, feasibility: t.feasibility,
  title: t.title, template_description: t.template_description,
  scoring_enabled: t.scoring_enabled,
  field_count: t.fields.filter((f) => f.type !== 'section_break').length,
  page_count: t.fields.filter((f) => f.type === 'section_break').length,
  rule_count: t.logic_rules.length,
  has_matrix: t.fields.some((f) => f.type === 'matrix'),
  has_media: t.fields.some((f) => f.type === 'image' || f.type === 'video'),
  has_file: t.fields.some((f) => f.type === 'file')
}));

const current = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as TemplateIndexEntry[];
if (JSON.stringify(current) !== JSON.stringify(expected)) {
  errors.push("  [index] index.json ne correspond plus aux fichiers — lancez `npm run templates:build`");
}

if (errors.length) {
  console.error(`✗ ${errors.length} problème(s) dans le catalogue :`);
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`✓ ${defs.length} modèles validés`);
