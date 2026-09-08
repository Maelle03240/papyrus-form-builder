import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import type { Field, FormSnapshot, LogicRule } from '@/types';

/**
 * L'instantané pris avant que l'IA ne touche à un formulaire.
 *
 * C'est ce qui rend « annuler ce que l'assistant vient de faire » atteignable
 * en un clic — et c'est pour cela que `form_versions` a été porté dès la
 * phase 1, avant l'IA plutôt qu'après : une construction pilotée par IA qu'on
 * ne peut pas défaire n'est pas utilisable.
 *
 * Une version serveur distincte de `lib/store/versions.ts`, qui est un module
 * navigateur. La forme de l'instantané, elle, est la MÊME : `restoreFormVersion`
 * côté client doit pouvoir restaurer ce qui a été écrit ici.
 */

type SessionClient = ReturnType<typeof createClient>;

/**
 * Ce qu'un instantané retient — repris à l'identique du module navigateur.
 *
 * `status`, `slug` et `published_at` en sont volontairement absents : restaurer
 * une version doit ramener des questions, pas dépublier un formulaire en ligne
 * ni changer une adresse publique qui a déjà circulé.
 */
const SNAPSHOT_FORM_KEYS = [
  'title',
  'description',
  'display_mode',
  'theme',
  'settings',
  'languages',
  'default_language',
  'scoring_enabled',
  'show_score_to_respondent',
  'save_and_resume',
  'unique_email',
  'require_all_by_default'
] as const;

export async function snapshotFormForAi(
  supabase: SessionClient,
  formId: string,
  label: string,
  userId: string,
  userName: string
): Promise<string | null> {
  const { data: form } = await supabase
    .from('forms')
    .select('*, fields(*), logic_rules(*)')
    .eq('id', formId)
    .maybeSingle();

  if (!form) return null;

  const meta: Record<string, unknown> = {};
  for (const key of SNAPSHOT_FORM_KEYS) {
    const value = (form as Record<string, unknown>)[key];
    if (value !== undefined) meta[key] = value;
  }

  const snapshot: FormSnapshot = {
    form: meta,
    fields: ((form.fields ?? []) as Field[]).sort((a, b) => a.field_order - b.field_order),
    logic_rules: ((form.logic_rules ?? []) as LogicRule[]).sort(
      (a, b) => (a.rule_order ?? 0) - (b.rule_order ?? 0)
    )
  };

  const { data, error } = await supabase
    .from('form_versions')
    .insert({
      form_id: formId,
      snapshot,
      label,
      // `ai` et non `auto` : les instantanés automatiques sont élagués au-delà
      // de vingt, ceux de l'IA jamais. On peut vouloir défaire une construction
      // longtemps après l'avoir acceptée.
      kind: 'ai',
      created_by: userId,
      created_by_name: userName
    })
    .select('id')
    .single();

  if (error) {
    // L'instantané n'est pas l'action : le rater ne doit pas empêcher
    // l'assistant de travailler. Mais le dire, parce que le tour sera alors
    // irréversible et que c'est une information, pas un détail.
    console.error('Instantané avant action IA échoué:', error);
    return null;
  }

  return data.id as string;
}
