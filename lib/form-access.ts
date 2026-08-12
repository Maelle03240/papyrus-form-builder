import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Jeton d'accès à un formulaire protégé par mot de passe.
 *
 * Le mot de passe est validé une fois, par `/api/forms/access`, qui renvoie ce
 * jeton signé. Le navigateur le garde en mémoire et le joint à l'envoi de la
 * réponse : sans lui, `/api/submit/[slug]` refuse une soumission sur un
 * formulaire protégé. Sans ce contrôle, connaître les identifiants des champs
 * suffirait à répondre sans jamais avoir eu le mot de passe.
 *
 * Un jeton plutôt qu'un cookie : un formulaire intégré dans le site d'un client
 * est en contexte tiers, où les cookies sont de plus en plus souvent bloqués.
 * Le jeton, lui, traverse l'iframe sans difficulté.
 */

/** Douze heures : le temps d'un événement, pas celui d'une session permanente. */
const TTL_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!value) {
    throw new Error(
      'APP_ENCRYPTION_KEY manquante : la protection par mot de passe ne peut pas être signée.'
    );
  }
  return value;
}

export function signFormAccessToken(formId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ formId, exp: Date.now() + TTL_MS })
  ).toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyFormAccessToken(formId: string, token: unknown): boolean {
  if (typeof token !== 'string') return false;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  let expected: string;
  try {
    expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  } catch {
    return false;
  }

  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      formId?: string;
      exp?: number;
    };
    return parsed.formId === formId && typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

/**
 * Comparaison du mot de passe saisi avec celui du formulaire.
 *
 * En temps constant, pour ne pas laisser deviner le mot de passe caractère par
 * caractère à partir du temps de réponse. Le mot de passe est stocké en clair —
 * c'est un code d'accès partagé entre tous les répondants, pas un identifiant
 * personnel : le hacher empêcherait son auteur de le relire dans l'interface,
 * ce qui est précisément ce qu'il vient y chercher.
 */
export function passwordMatches(expected: string | null | undefined, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  if (!expected) return false;

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Comparer malgré tout, pour que le temps de réponse ne trahisse pas la
    // longueur attendue.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
