import 'server-only';

import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';
import { PAPYRUS_SCHEMA } from '@/lib/supabase/client';
import { partnerConfigOf } from '@/lib/partners';
import type { PublicPartnerJoin, PublicPartnerLink } from '@/types';

/**
 * Chargement des pages publiques du programme partenaire.
 *
 * Même principe que `lib/public-form.ts` : on lit les VUES `public_partner_*`,
 * jamais les tables. Le rôle `anon` n'a aucun droit sur `partners` — la vue est
 * ce qui décide de ce qu'un visiteur peut voir, et elle laisse dehors le jeton
 * de portail, l'adresse e-mail et les notes internes.
 *
 * Le client est construit sans cookies : la page d'accueil d'un partenaire doit
 * être identique pour tout le monde, y compris pour un membre de l'équipe
 * connecté qui vérifie à quoi elle ressemble.
 */

function createPublicClient() {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: PAPYRUS_SCHEMA },
    cookies: { getAll: () => [], setAll: () => {} }
  });
}

export const getPartnerLink = cache(async (code: string): Promise<PublicPartnerLink | null> => {
  const { data, error } = await createPublicClient()
    .from('public_partner_links')
    .select('*')
    .eq('code', code)
    .maybeSingle();

  if (error || !data) return null;

  return {
    ...(data as PublicPartnerLink),
    partner_config: partnerConfigOf((data as PublicPartnerLink).partner_config)
  };
});

export const getPartnerJoin = cache(async (token: string): Promise<PublicPartnerJoin | null> => {
  const { data, error } = await createPublicClient()
    .from('public_partner_join')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (error || !data) return null;

  return {
    ...(data as PublicPartnerJoin),
    partner_config: partnerConfigOf((data as PublicPartnerJoin).partner_config)
  };
});
