import type { Field, LogicRule, Section, VisibilityRule } from '@/types';
import { evaluateConditions, evaluateLogicRules } from '@/lib/logic-evaluation';

/**
 * Visibilité effective d'un formulaire : quelles sections et quelles questions
 * sont réellement à l'écran, compte tenu des réponses déjà données.
 *
 * C'est le point d'entrée unique — navigateur et serveur appellent celui-ci, et
 * pas `evaluateLogicRules` directement. Les deux ne peuvent donc pas diverger,
 * et un champ masqué à l'écran ne peut pas être exigé à l'envoi.
 *
 * Deux mécanismes s'y combinent :
 *
 * · les **règles de logique** (`logic_rules`), écrites depuis la question
 *   source : « quand on répond oui ici, montrer là-bas » ;
 * · les **verrous de visibilité** (`Field.visibility`, `Section.visibility`),
 *   écrits depuis l'élément cible : « ne m'affiche que si… ».
 *
 * Ils se combinent par un ET. Un verrou ne peut donc jamais forcer l'apparition
 * de ce qu'une règle `hide_field` masque — sans cette règle d'arbitrage, deux
 * auteurs travaillant chacun dans son panneau écriraient l'inverse l'un de
 * l'autre sans jamais voir le conflit.
 */

export interface VisibilityInput {
  fields?: Field[];
  sections?: Section[];
  logic_rules?: LogicRule[];
}

export interface VisibilityResult {
  /** Identifiants des champs visibles. */
  fields: Set<string>;
  /** Identifiants des sections visibles. */
  sections: Set<string>;
}

/**
 * Nombre maximal de passes du point fixe.
 *
 * Une chaîne de dépendances ne peut pas être plus longue que le nombre de
 * questions, mais deux verrous peuvent s'exclure mutuellement — A masque B,
 * l'absence de B rouvre A — et osciller indéfiniment. Le plafond garantit la
 * terminaison ; en cas d'oscillation, c'est le dernier état calculé qui est
 * retenu, toujours le même pour les mêmes réponses.
 */
const MAX_PASSES = 20;

/** Un verrou sans condition est ouvert : c'est l'état par défaut. */
export function isUnlocked(
  rule: VisibilityRule | undefined | null,
  responses: Record<string, unknown>
): boolean {
  const conditions = rule?.conditions;
  if (!conditions || conditions.length === 0) return true;
  return evaluateConditions(conditions, rule?.operator ?? 'AND', responses);
}

export function evaluateFormVisibility(
  form: VisibilityInput,
  responses: Record<string, unknown>
): VisibilityResult {
  const fields = form.fields ?? [];
  const sections = form.sections ?? [];
  const rules = form.logic_rules ?? [];

  let hidden = new Set<string>();
  let result = evaluateOnce(fields, sections, rules, responses);

  // Point fixe : une question masquée n'a pas de réponse. Sans cette reprise,
  // une chaîne « Q1 montre Q2, la réponse à Q2 montre Q3 » resterait ouverte
  // après un retour en arrière sur Q1 : Q2 disparaîtrait de l'écran mais sa
  // réponse, restée en mémoire, continuerait d'afficher Q3.
  for (let pass = 1; pass < MAX_PASSES; pass++) {
    const nextHidden = new Set(
      fields.filter((field) => !result.fields.has(field.id)).map((field) => field.id)
    );
    if (sameIds(nextHidden, hidden)) break;

    hidden = nextHidden;
    result = evaluateOnce(fields, sections, rules, maskAnswers(responses, hidden));
  }

  return result;
}

function evaluateOnce(
  fields: Field[],
  sections: Section[],
  rules: LogicRule[],
  responses: Record<string, unknown>
): VisibilityResult {
  const visibleSections = new Set(
    sections
      .filter((section) => !section.hidden && isUnlocked(section.visibility, responses))
      .map((section) => section.id)
  );

  // Un formulaire chargé sans ses sections — une requête qui ne les a pas
  // demandées — ne doit pas voir toutes ses questions disparaître. En leur
  // absence, le découpage ne filtre rien.
  const sectionsKnown = sections.length > 0;

  const byLogic = evaluateLogicRules(rules, responses, fields);

  const visibleFields = new Set(
    fields
      .filter((field) => {
        if (sectionsKnown && !visibleSections.has(field.section_id)) return false;
        if (!byLogic.has(field.id)) return false;
        return isUnlocked(field.visibility, responses);
      })
      .map((field) => field.id)
  );

  return { fields: visibleFields, sections: visibleSections };
}

/**
 * Écarte les réponses des champs masqués, sous-questions comprises.
 *
 * Les sous-questions d'une option cochée sont stockées sous
 * `champ__option__sousChamp` : leur racine est le champ, et elles doivent
 * disparaître avec lui.
 */
function maskAnswers(
  responses: Record<string, unknown>,
  hidden: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(responses)) {
    if (hidden.has(key.split('__')[0])) continue;
    out[key] = value;
  }
  return out;
}

function sameIds(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
