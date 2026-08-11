import 'server-only';

/**
 * Limiteur de débit en mémoire (fenêtre glissante simple).
 *
 * Portée : le processus Node courant. L'app tourne en conteneur unique sur
 * Easypanel, ce qui suffit pour bloquer le spam de formulaires et l'abus des
 * routes d'upload. Si Papyrus est un jour répliqué sur plusieurs instances,
 * remplacer ce module par un compteur Redis — l'interface ne changera pas.
 */

interface Bucket {
  count: number;
  /** Timestamp (ms) de fin de la fenêtre courante. */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Purge les compteurs expirés pour éviter que la Map ne grossisse indéfiniment. */
function sweep(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Nombre de requêtes restantes dans la fenêtre. */
  remaining: number;
  /** Secondes à attendre avant de réessayer (0 si autorisé). */
  retryAfterSeconds: number;
}

/**
 * Consomme un jeton pour `key`.
 *
 * @param key      identifiant du seau (ex. `submit:<slug>:<ip>`)
 * @param limit    nombre de requêtes autorisées par fenêtre
 * @param windowMs durée de la fenêtre en millisecondes
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/**
 * Adresse IP du client derrière le reverse proxy Easypanel (Traefik/Caddy).
 * `x-forwarded-for` peut être falsifié si le proxy ne la réécrit pas — on ne
 * l'utilise donc que pour le rate limiting et le hachage d'IP, jamais pour de
 * l'autorisation.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
