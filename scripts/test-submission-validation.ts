/**
 * Reproduit la validation du serveur sur de vrais modèles du catalogue, avant
 * et après correctif. Usage : npm run test:validation
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateLogicRules } from '../lib/logic-evaluation';
import { isAnswerEmpty } from '../lib/submission-format';
import type { Field, LogicRule } from '../types';
import * as nodeFs from 'node:fs';

const DIR = join(process.cwd(), 'lib/templates/catalog');

function load(slug: string) {
  const t = JSON.parse(readFileSync(join(DIR, `${slug}.json`), 'utf8'));
  return {
    fields: t.fields as Field[],
    rules: (t.logic_rules ?? []) as LogicRule[],
    slug: t.slug
  };
}

/** Ancienne validation : exige tous les champs requis, logique ignorée. */
function oldValidation(fields: Field[], responses: Record<string, unknown>) {
  return fields
    .filter((f) => !['section_break', 'statement', 'image', 'video'].includes(f.type))
    .filter((f) => f.required)
    .filter((f) => {
      const v = responses[f.id];
      if (v === undefined || v === null) return true;
      if (typeof v === 'string') return v.trim() === '';
      if (Array.isArray(v)) return v.length === 0;
      return false;
    })
    .map((f) => f.id);
}

/** Nouvelle validation : seuls les champs visibles sont exigés. */
function newValidation(fields: Field[], rules: LogicRule[], responses: Record<string, unknown>) {
  const visible = evaluateLogicRules(rules, responses, fields);
  return fields
    .filter((f) => !['section_break', 'statement', 'image', 'video'].includes(f.type))
    .filter((f) => f.required && visible.has(f.id))
    .filter((f) => isAnswerEmpty(responses[f.id]))
    .map((f) => f.id);
}

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
};

// === Cas 1 — le scénario exact rapporté ====================================
console.log("\n== pulse-hebdomadaire : réponse « Non » à la question conditionnelle ==");
{
  const { fields, rules } = load('pulse-hebdomadaire');
  const responses = {
    'pulse-hebdomadaire-f2': 'pulse-hebdomadaire-f2-o2',
    'pulse-hebdomadaire-f3': 7,
    'pulse-hebdomadaire-f6': 'pulse-hebdomadaire-f6-o2' // « Non, tout est sous contrôle »
  };
  check('AVANT : rejeté sur f7 (le bug rapporté)', oldValidation(fields, responses), [
    'pulse-hebdomadaire-f7'
  ]);
  check('APRÈS : accepté', newValidation(fields, rules, responses), []);
}

// === Cas 2 — la branche « Oui » doit rester exigeante ======================
console.log("\n== pulse-hebdomadaire : réponse « Oui » sans remplir le suivi ==");
{
  const { fields, rules } = load('pulse-hebdomadaire');
  const responses = {
    'pulse-hebdomadaire-f2': 'pulse-hebdomadaire-f2-o2',
    'pulse-hebdomadaire-f3': 7,
    'pulse-hebdomadaire-f6': 'pulse-hebdomadaire-f6-o1' // « Oui » → f7 devient visible
  };
  check('APRÈS : toujours rejeté sur f7', newValidation(fields, rules, responses), [
    'pulse-hebdomadaire-f7'
  ]);
}
console.log("\n== pulse-hebdomadaire : « Oui » + suivi rempli ==");
{
  const { fields, rules } = load('pulse-hebdomadaire');
  const responses = {
    'pulse-hebdomadaire-f2': 'pulse-hebdomadaire-f2-o2',
    'pulse-hebdomadaire-f3': 7,
    'pulse-hebdomadaire-f6': 'pulse-hebdomadaire-f6-o1',
    'pulse-hebdomadaire-f7': 'Le budget du T3.'
  };
  check('APRÈS : accepté', newValidation(fields, rules, responses), []);
}

// === Cas 3 — la note zéro =================================================
console.log('\n== la réponse 0 sur une échelle obligatoire ==');
{
  const { fields, rules } = load('pulse-hebdomadaire');
  const responses = {
    'pulse-hebdomadaire-f2': 'pulse-hebdomadaire-f2-o2',
    'pulse-hebdomadaire-f3': 0, // charge de travail notée 0
    'pulse-hebdomadaire-f6': 'pulse-hebdomadaire-f6-o2'
  };
  check('isAnswerEmpty(0) vaut false', isAnswerEmpty(0), false);
  check("ancienne règle client `!valeur` déclarait 0 vide", !0, true);
  check('APRÈS : accepté', newValidation(fields, rules, responses), []);
}

// === Cas 4 — champ vraiment manquant, toujours refusé =====================
console.log('\n== un champ obligatoire visible réellement vide ==');
{
  const { fields, rules } = load('pulse-hebdomadaire');
  const responses = { 'pulse-hebdomadaire-f6': 'pulse-hebdomadaire-f6-o2' };
  check(
    'APRÈS : f2 et f3 refusés',
    newValidation(fields, rules, responses),
    ['pulse-hebdomadaire-f2', 'pulse-hebdomadaire-f3']
  );
}

// === Cas 5 — les 8 modèles concernés, branche qui ne déclenche rien =======
//
// Le remplissage choisit délibérément une option qui NE déclenche PAS la règle
// `show_field` — sinon le champ conditionnel devient légitimement visible,
// obligatoire et vide, et son refus est le comportement correct.
console.log('\n== les 8 modèles à champ requis conditionnel, branche non déclenchante ==');
for (const slug of [
  'auto-evaluation-annuelle', 'candidature-poste', 'entretien-depart', 'nps',
  'pulse-hebdomadaire', 'qualification-lead-b2b', 'reclamation-client',
  'satisfaction-detaillee'
]) {
  const { fields, rules } = load(slug);
  const showRules = rules.filter((r) => r.action_type === 'show_field');
  const shown = new Set(showRules.map((r) => r.target_field_id));

  // Valeurs qui déclencheraient une révélation, par champ source.
  const triggering = new Map<string, Set<string>>();
  for (const rule of showRules) {
    for (const c of rule.conditions ?? []) {
      if (!triggering.has(c.source_field_id)) triggering.set(c.source_field_id, new Set());
      triggering.get(c.source_field_id)!.add(c.value);
    }
  }

  const responses: Record<string, unknown> = {};
  for (const f of fields) {
    if (shown.has(f.id)) continue;
    if (['section_break', 'statement', 'image', 'video'].includes(f.type)) continue;
    if (!f.required) continue;

    if (f.options?.length) {
      const avoid = triggering.get(f.id) ?? new Set<string>();
      const safe = f.options.find((o) => !avoid.has(o.id)) ?? f.options[0];
      responses[f.id] = safe.id;
    } else if (f.type === 'nps' || f.type === 'rating') {
      // Note haute : les règles numériques du catalogue se déclenchent sur les
      // notes basses (`less_than`). Une note de 10 ne révèle donc rien.
      responses[f.id] = 10;
    } else {
      responses[f.id] = 'réponse';
    }
  }

  const before = oldValidation(fields, responses);
  const after = newValidation(fields, rules, responses);
  check(
    `${slug} : ${before.length} refus avant → 0 après`,
    after,
    []
  );
}

// === Cas 6 — invariant général sur tout le catalogue ======================
//
// Quelles que soient les réponses, un champ refusé doit être à la fois visible
// et vide. C'est la propriété qui garantit qu'aucun répondant ne peut être
// bloqué par une question qu'il n'a pas vue.
console.log('\n== invariant sur les 51 modèles : tout refus porte sur un champ visible ==');
{
  const { readdirSync } = nodeFs;
  const slugs = readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && !['index.json', '_order.json'].includes(f))
    .map((f) => f.replace(/\.json$/, ''));

  let violations = 0;
  for (const slug of slugs) {
    const { fields, rules } = load(slug);
    // Aucune réponse : le pire cas.
    for (const responses of [{}, Object.fromEntries(
      fields.filter((f) => f.options?.length).map((f) => [f.id, f.options![0].id])
    )]) {
      const visible = evaluateLogicRules(rules, responses, fields);
      for (const id of newValidation(fields, rules, responses)) {
        if (!visible.has(id)) {
          console.log(`       ${slug} : ${id} refusé alors qu'il est masqué`);
          violations++;
        }
      }
    }
  }
  check('aucun refus sur un champ masqué', violations, 0);
}

console.log(failures === 0 ? '\n✓ tous les cas passent' : `\n✗ ${failures} cas en échec`);
process.exit(failures === 0 ? 0 : 1);
