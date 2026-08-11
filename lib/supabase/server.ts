import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_ANON_KEY, SUPABASE_URL, getSupabaseServiceRoleKey } from '@/lib/env';
import { PAPYRUS_SCHEMA } from './client';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Client Supabase côté serveur (Server Components, Route Handlers).
 * Agit avec les droits de l'utilisateur connecté : la RLS s'applique.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: PAPYRUS_SCHEMA },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Appelé depuis un Server Component : le middleware rafraîchit la session.
        }
      }
    }
  });
}

/**
 * Client `service_role` — contourne TOTALEMENT la RLS.
 *
 * À n'utiliser que dans du code serveur qui a déjà vérifié lui-même les droits
 * de l'appelant. Il ne porte aucun cookie : il n'a pas d'identité utilisateur,
 * donc `auth.uid()` y est nul et aucune policy ne le protège.
 */
export function createAdminClient() {
  return createServerClient(SUPABASE_URL, getSupabaseServiceRoleKey(), {
    db: { schema: PAPYRUS_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
    cookies: {
      getAll: () => [],
      setAll: () => {}
    }
  });
}
