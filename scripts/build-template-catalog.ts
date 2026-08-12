/**
 * Régénère `lib/templates/catalog/index.json` et `lib/templates/generated.ts`
 * à partir des fichiers de modèles.
 *
 * Usage : npm run templates:build
 *
 * Le script est rejouable à volonté : sur un catalogue inchangé, il réécrit des
 * fichiers identiques (diff vide).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TemplateDefinition, TemplateIndexEntry } from '../lib/templates/types';

const DIR = join(process.cwd(), 'lib/templates/catalog');
const GENERATED = join(process.cwd(), 'lib/templates/generated.ts');

const camel = (s: string) =>
  s.split('-').map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');

/**
 * L'ordre vient de `_order.json`, jamais du système de fichiers.
 * Un `readdirSync().sort()` rangerait les 51 modèles par ordre alphabétique et
 * casserait le regroupement par catégorie du rail de la galerie.
 */
const { order } = JSON.parse(readFileSync(join(DIR, '_order.json'), 'utf8')) as {
  order: string[];
};

const onDisk = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== '_order.json')
  .map((f) => f.replace(/\.json$/, ''));

const missing = order.filter((s) => !onDisk.includes(s));
const orphans = onDisk.filter((s) => !order.includes(s));

if (missing.length || orphans.length) {
  console.error('✗ _order.json et le dossier catalog/ divergent.');
  if (missing.length) console.error('  listés sans fichier :', missing.join(', '));
  if (orphans.length) console.error('  fichiers non listés  :', orphans.join(', '));
  process.exit(1);
}

const defs: TemplateDefinition[] = order.map(
  (slug) => JSON.parse(readFileSync(join(DIR, `${slug}.json`), 'utf8')) as TemplateDefinition
);

const index: TemplateIndexEntry[] = defs.map((t) => ({
  id: t.id,
  slug: t.slug,
  category: t.category,
  icon: t.icon,
  display_mode: t.display_mode,
  feasibility: t.feasibility,
  title: t.title,
  template_description: t.template_description,
  scoring_enabled: t.scoring_enabled,
  field_count: t.fields.filter((f) => f.type !== 'section_break').length,
  page_count: t.fields.filter((f) => f.type === 'section_break').length,
  rule_count: t.logic_rules.length,
  has_matrix: t.fields.some((f) => f.type === 'matrix'),
  has_media: t.fields.some((f) => f.type === 'image' || f.type === 'video'),
  has_file: t.fields.some((f) => f.type === 'file')
}));

writeFileSync(join(DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');

const lines = [
  '// AUTO-GÉNÉRÉ par scripts/build-template-catalog.ts — NE PAS ÉDITER À LA MAIN.',
  "import 'server-only';",
  "import type { TemplateDefinition, TemplateIndexEntry } from './types';",
  "import indexJson from './catalog/index.json';",
  '',
  ...defs.map((t) => `import ${camel(t.slug)} from './catalog/${t.slug}.json';`),
  '',
  'export const TEMPLATE_INDEX = indexJson as TemplateIndexEntry[];',
  '',
  'const CATALOG: Record<string, TemplateDefinition> = {',
  ...defs.map((t) => `  '${t.slug}': ${camel(t.slug)} as unknown as TemplateDefinition,`),
  '};',
  '',
  'export function getTemplateDefinition(slug: string): TemplateDefinition | null {',
  '  return CATALOG[slug] ?? null;',
  '}',
  '',
  'export function listTemplateDefinitions(): TemplateDefinition[] {',
  '  return Object.values(CATALOG);',
  '}',
  ''
];

writeFileSync(GENERATED, lines.join('\n'));
console.log(`✓ ${defs.length} modèles · index.json + generated.ts régénérés`);
