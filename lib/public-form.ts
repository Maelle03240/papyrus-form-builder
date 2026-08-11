import 'server-only';

import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';
import { PAPYRUS_SCHEMA } from '@/lib/supabase/client';
import type { Field, Form, LogicRule } from '@/types';

/**
 * Chargement d'un formulaire pour la vue publique `/f/[slug]`.
 *
 * Lit les VUES `public_*`, jamais les tables. Les tables `forms`, `fields` et
 * `logic_rules` ne sont pas lisibles par le rôle `anon` : elles exposeraient
 * `access_password` et les formulaires encore en brouillon. Les vues filtrent
 * elles-mêmes sur `status = 'published'` et sur la date de clôture, et
 * remplacent le mot de passe par un simple booléen `requires_password`.
 *
 * Le client est créé sans cookies : cette page ne dépend d'aucune session, et un
 * répondant connecté ne doit pas voir un formulaire différent d'un visiteur.
 */

export interface PublicForm extends Form {
  /** Indique qu'un mot de passe protège le formulaire, sans jamais le divulguer. */
  requires_password?: boolean;
}

function createPublicClient() {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: PAPYRUS_SCHEMA },
    cookies: { getAll: () => [], setAll: () => {} }
  });
}

/**
 * `cache()` dédoublonne l'appel au sein d'une même requête : la page et
 * `generateMetadata` demandent le même formulaire, ce qui déclenchait
 * auparavant deux allers-retours complets vers la base.
 */
export const getPublicForm = cache(async (slug: string): Promise<PublicForm | null> => {
  const supabase = createPublicClient();

  const { data: form, error } = await supabase
    .from('public_forms')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !form) return null;

  // Les vues ne peuvent pas être jointes comme des relations PostgREST : on
  // charge champs et règles en parallèle, filtrés sur le formulaire trouvé.
  const [fieldsResult, rulesResult] = await Promise.all([
    supabase.from('public_fields').select('*').eq('form_id', form.id),
    supabase.from('public_logic_rules').select('*').eq('form_id', form.id)
  ]);

  const fields = ((fieldsResult.data ?? []) as Field[]).sort(
    (a, b) => a.field_order - b.field_order
  );
  const logicRules = ((rulesResult.data ?? []) as LogicRule[]).sort(
    (a, b) => (a.rule_order ?? 0) - (b.rule_order ?? 0)
  );

  return { ...(form as PublicForm), fields, logic_rules: logicRules };
});
