import 'server-only';

import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';
import { PAPYRUS_SCHEMA } from '@/lib/supabase/client';
import type { Field, Form, LogicRule, Section } from '@/types';

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
  /**
   * Le formulaire n'accepte plus de réponses : archivé, date limite dépassée, ou
   * quota atteint. La vue le calcule elle-même — le compte exact des réponses
   * n'est pas exposé, seulement le fait que la limite est franchie.
   */
  is_closed?: boolean;
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

  // Un formulaire clos ne divulgue pas ses questions : `public_fields` filtre sur
  // `status = 'published'` et sur la date limite, donc les deux requêtes qui
  // suivent renverraient de toute façon des listes vides. On s'épargne l'aller-
  // retour et on renvoie l'enveloppe nécessaire à l'affichage du message.
  if ((form as PublicForm).is_closed) {
    return { ...(form as PublicForm), sections: [], fields: [], logic_rules: [] };
  }

  // Un formulaire protégé ne livre pas ses questions avant que le mot de passe
  // ne soit validé. Les charger ici les embarquerait dans le rendu envoyé au
  // navigateur : l'écran de saisie ne serait qu'un rideau, contournable en
  // ouvrant les outils de développement.
  if ((form as PublicForm).requires_password) {
    return { ...(form as PublicForm), sections: [], fields: [], logic_rules: [] };
  }

  return withRelations(supabase, form as PublicForm);
});

/**
 * Formulaire complet, une fois le mot de passe validé.
 * Réservé aux routes serveur qui ont elles-mêmes vérifié l'accès.
 */
export async function getUnlockedPublicForm(slug: string): Promise<PublicForm | null> {
  const supabase = createPublicClient();

  const { data: form, error } = await supabase
    .from('public_forms')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !form) return null;
  if ((form as PublicForm).is_closed) return null;

  return withRelations(supabase, form as PublicForm);
}

async function withRelations(
  supabase: ReturnType<typeof createPublicClient>,
  form: PublicForm
): Promise<PublicForm> {
  // Les vues ne peuvent pas être jointes comme des relations PostgREST : on
  // charge sections, champs et règles en parallèle, filtrés sur le formulaire.
  const [sectionsResult, fieldsResult, rulesResult] = await Promise.all([
    supabase.from('public_sections').select('*').eq('form_id', form.id),
    supabase.from('public_fields').select('*').eq('form_id', form.id),
    supabase.from('public_logic_rules').select('*').eq('form_id', form.id)
  ]);

  const sections = ((sectionsResult.data ?? []) as Section[]).sort(
    (a, b) => a.section_order - b.section_order
  );

  // `field_order` est relatif à sa section : trier les champs sur ce seul
  // critère entrelacerait les sections, et le répondant verrait les questions
  // dans le désordre — sans la moindre erreur pour le signaler.
  const rank = new Map(sections.map((section) => [section.id, section.section_order]));
  const fields = ((fieldsResult.data ?? []) as Field[]).sort((a, b) => {
    const bySection =
      (rank.get(a.section_id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.section_id) ?? Number.MAX_SAFE_INTEGER);
    return bySection !== 0 ? bySection : a.field_order - b.field_order;
  });

  const logicRules = ((rulesResult.data ?? []) as LogicRule[]).sort(
    (a, b) => (a.rule_order ?? 0) - (b.rule_order ?? 0)
  );

  return {
    ...form,
    sections: sections.map((section) => ({
      ...section,
      fields: fields.filter((field) => field.section_id === section.id)
    })),
    fields,
    logic_rules: logicRules
  };
}
