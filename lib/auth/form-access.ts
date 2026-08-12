import 'server-only';

import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';

/**
 * Garde d'accès des routes API qui manipulent un formulaire.
 *
 * Rappel de l'invariant : toute route qui emploie `createAdminClient()`
 * (service_role) contourne la RLS et doit donc vérifier elle-même les droits de
 * l'appelant. C'est exactement ce que fait cette fonction, en un seul endroit
 * plutôt qu'un par route.
 */

export interface FormAccess {
  userId: string;
  formId: string;
  teamId: string;
  role: string;
}

type Guard = { error: NextResponse } | { access: FormAccess };

export async function requireFormAccess(formId: string): Promise<Guard> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) };
  }

  const admin = createAdminClient();

  const { data: form } = await admin
    .from('forms')
    .select('id, team_id')
    .eq('id', formId)
    .maybeSingle();

  if (!form) {
    return { error: NextResponse.json({ error: 'Formulaire introuvable' }, { status: 404 }) };
  }

  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', form.team_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) {
    // Même réponse que pour un formulaire inexistant : répondre 403 confirmerait
    // à un curieux qu'un formulaire porte bien cet identifiant.
    return { error: NextResponse.json({ error: 'Formulaire introuvable' }, { status: 404 }) };
  }

  return {
    access: { userId: user.id, formId: form.id, teamId: form.team_id, role: membership.role }
  };
}

/** Variante pour les routes qui portent sur un espace de travail entier. */
export async function requireTeamMembership(
  teamId: string
): Promise<{ error: NextResponse } | { userId: string; role: string }> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) };
  }

  const { data: membership } = await createAdminClient()
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) {
    return {
      error: NextResponse.json({ error: 'Espace de travail introuvable' }, { status: 404 })
    };
  }

  return { userId: user.id, role: membership.role };
}
