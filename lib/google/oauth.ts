import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getGoogleOAuthConfig } from '@/lib/env';

/**
 * OAuth 2.0 Google — obtention et rafraîchissement des jetons.
 *
 * Aucune dépendance `googleapis` : les quatre appels dont nous avons besoin
 * tiennent en une poignée de `fetch`, et le SDK officiel pèse plusieurs dizaines
 * de mégaoctets pour le reste de la surface de l'API.
 *
 * Ce qui est conservé en base : le refresh token, chiffré (lib/crypto.ts). Les
 * jetons d'accès, valables une heure, sont redemandés à chaque besoin et ne
 * quittent jamais la mémoire du processus.
 */

/**
 * `spreadsheets` autorise l'écriture dans une feuille dont on connaît
 * l'identifiant ; `drive.file` permet d'en créer une et de retrouver celles que
 * Papyrus a créées. On évite volontairement `drive.readonly`, un scope restreint
 * qui imposerait une revue de sécurité annuelle par Google.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file'
].join(' ');

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Le jeton n'est plus valide : l'espace doit reconnecter son compte Google. */
    readonly needsReconnect = false
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

// ----------------------------------------------------------------------------
// Paramètre `state` — protection CSRF du callback
// ----------------------------------------------------------------------------

interface OAuthState {
  teamId: string;
  formId?: string;
  userId: string;
  issuedAt: number;
}

function stateSecret(): string {
  // Réutilise la clé de chiffrement applicative : elle est déjà obligatoire pour
  // stocker le jeton, donc l'intégration ne peut pas fonctionner sans elle.
  const secret = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!secret) throw new Error('APP_ENCRYPTION_KEY manquante.');
  return secret;
}

/** Sérialise et signe le `state` transmis à Google puis renvoyé au callback. */
export function encodeState(state: Omit<OAuthState, 'issuedAt'>): string {
  const payload = Buffer.from(
    JSON.stringify({ ...state, issuedAt: Date.now() } satisfies OAuthState)
  ).toString('base64url');
  const signature = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * Vérifie la signature et l'ancienneté du `state`.
 * Renvoie `null` si le paramètre a été forgé, altéré ou a plus de dix minutes —
 * sans quoi n'importe quel site pourrait faire rattacher un compte Google à
 * l'espace de travail de son choix.
 */
export function decodeState(raw: string | null): OAuthState | null {
  if (!raw) return null;

  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;

  const expected = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
    if (Date.now() - state.issuedAt > 10 * 60_000) return null;
    return state;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Flux d'autorisation
// ----------------------------------------------------------------------------

/** URL de l'écran de consentement Google. */
export function buildAuthUrl(state: string): string {
  const config = getGoogleOAuthConfig();
  if (!config) throw new GoogleApiError("L'intégration Google n'est pas configurée.", 503);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    // `offline` est indispensable : sans lui Google ne renvoie pas de refresh
    // token et la connexion expirerait au bout d'une heure.
    access_type: 'offline',
    // `consent` force la réémission du refresh token, y compris pour un compte
    // ayant déjà autorisé l'application : sans cela, une reconnexion après
    // révocation ne renverrait aucun jeton réutilisable.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/** Échange le code d'autorisation contre un couple access / refresh token. */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const config = getGoogleOAuthConfig();
  if (!config) throw new GoogleApiError("L'intégration Google n'est pas configurée.", 503);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code'
    })
  });

  if (!response.ok) {
    throw new GoogleApiError("Google a refusé l'autorisation.", response.status);
  }

  return (await response.json()) as TokenResponse;
}

/** Échange un refresh token contre un jeton d'accès valable une heure. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const config = getGoogleOAuthConfig();
  if (!config) throw new GoogleApiError("L'intégration Google n'est pas configurée.", 503);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    // 400 / 401 sur un refresh signifie que l'utilisateur a révoqué l'accès ou
    // changé son mot de passe : il faut refaire le consentement, pas réessayer.
    throw new GoogleApiError(
      'La connexion Google a expiré ou a été révoquée. Reconnectez le compte.',
      response.status,
      response.status === 400 || response.status === 401
    );
  }

  const body = (await response.json()) as TokenResponse;
  return body.access_token;
}

/** Adresse du compte Google autorisé — affichée pour confirmer la connexion. */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { email?: string };
  return body.email ?? null;
}

/** Révoque le jeton côté Google. Silencieux en cas d'échec : la suppression locale prime. */
export async function revokeToken(refreshToken: string): Promise<void> {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken })
    });
  } catch {
    // Le compte est de toute façon déconnecté côté Papyrus.
  }
}
