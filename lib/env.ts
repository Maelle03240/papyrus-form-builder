/**
 * Accès centralisé et validé aux variables d'environnement.
 *
 * Règle : aucune valeur n'est écrite en dur ici. Les secrets de production vivent
 * uniquement dans l'onglet Environment du service Easypanel (source de vérité :
 * Vaultwarden, collection « MOOOVE IT »).
 *
 * Les variables `NEXT_PUBLIC_*` sont inlinées dans le bundle navigateur par Next.js :
 * elles doivent donc être référencées littéralement (pas via `process.env[nom]`).
 */

/** Lit une variable serveur obligatoire. Lève une erreur explicite si absente. */
function requireServerEnv(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      `Variable d'environnement manquante : ${name}. ` +
        `Ajoutez-la dans l'onglet Environment du service Easypanel (valeur dans Vaultwarden « MOOOVE IT »).`
    );
  }
  return trimmed;
}

// ----------------------------------------------------------------------------
// Supabase (auto-hébergé — projet Easypanel `main` / service `supabase`)
// ----------------------------------------------------------------------------

/** URL publique de l'API Supabase. Exposée au navigateur (sans danger). */
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();

/** Clé `anon` — client-side, ne fonctionne que sur des tables avec RLS activée. */
export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

/**
 * Clé `service_role` — contourne totalement la RLS.
 * Ne JAMAIS l'importer depuis un composant client : cet accesseur lève une erreur
 * si on tente de l'évaluer côté navigateur.
 */
export function getSupabaseServiceRoleKey(): string {
  if (typeof window !== 'undefined') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY ne doit jamais être lue côté navigateur.');
  }
  return requireServerEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Vérifie que la configuration Supabase publique est présente. */
export function assertSupabaseConfigured(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase n'est pas configuré : NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requis."
    );
  }
}

// ----------------------------------------------------------------------------
// Cloudflare R2 — stockage images & vidéos (jamais Supabase Storage)
// ----------------------------------------------------------------------------

export interface R2Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

/** Base URL publique des médias (CDN Cloudflare). Utilisable côté navigateur. */
export const R2_PUBLIC_BASE_URL = (
  process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ?? 'https://media.mooove.ltd'
).replace(/\/$/, '');

/**
 * Configuration R2 complète — serveur uniquement (contient la clé secrète).
 * Appelée seulement depuis les routes qui signent les URLs d'upload.
 */
export function getR2Config(): R2Config {
  if (typeof window !== 'undefined') {
    throw new Error('La configuration R2 (clé secrète) ne doit jamais être lue côté navigateur.');
  }
  return {
    endpoint: requireServerEnv('R2_ENDPOINT', process.env.R2_ENDPOINT),
    bucket: requireServerEnv('R2_BUCKET_NAME', process.env.R2_BUCKET_NAME),
    region: (process.env.R2_REGION ?? 'auto').trim(),
    accessKeyId: requireServerEnv('R2_ACCESS_KEY_ID', process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: requireServerEnv('R2_SECRET_ACCESS_KEY', process.env.R2_SECRET_ACCESS_KEY),
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL ?? R2_PUBLIC_BASE_URL).replace(/\/$/, '')
  };
}

// ----------------------------------------------------------------------------
// Application
// ----------------------------------------------------------------------------

/** Nom du dossier racine des objets R2 créés par cette app (convention `{app}/{uuid}.{ext}`). */
export const R2_APP_PREFIX = 'papyrus';

/** URL canonique de l'application. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

/** Clé API Resend (envoi d'emails) — serveur uniquement, optionnelle. */
export function getResendApiKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null;
}

/** Clé OpenRouter pour la génération de formulaire par IA — serveur uniquement, optionnelle. */
export function getOpenRouterApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}
