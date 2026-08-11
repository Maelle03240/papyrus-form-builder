import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';

/**
 * Client Supabase côté navigateur — à utiliser dans les composants `use client`.
 *
 * Toutes les tables de Papyrus vivent dans le schéma `papyrus`, pas dans
 * `public` : ce Supabase est partagé par une quinzaine d'applications et des
 * noms comme `forms` ou `profiles` y entreraient en collision. Le schéma est
 * fixé ici une fois pour toutes, ce qui laisse les appels `.from('forms')`
 * inchangés dans tout le reste du code.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: PAPYRUS_SCHEMA }
  });
}

/** Schéma applicatif — une seule définition, partagée par les trois clients. */
export const PAPYRUS_SCHEMA = 'papyrus';
