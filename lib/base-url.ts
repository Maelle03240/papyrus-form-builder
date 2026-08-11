import 'server-only';

import type { NextRequest } from 'next/server';
import { APP_URL } from '@/lib/env';

/**
 * URL publique de l'application, telle qu'elle doit apparaître dans une
 * redirection ou un email.
 *
 * Ne jamais utiliser `request.nextUrl.origin` pour cela. Derrière le reverse
 * proxy d'Easypanel, le serveur Next.js écoute sur `0.0.0.0:80` et c'est cette
 * adresse-là qu'il reconstruit : une redirection bâtie dessus envoie le
 * navigateur sur `https://0.0.0.0:80/…`, qui n'existe pas. C'est ce qui cassait
 * le retour de connexion Google.
 *
 * Ordre de résolution :
 *   1. `NEXT_PUBLIC_APP_URL` — la valeur canonique, configurée dans Easypanel ;
 *   2. les en-têtes `x-forwarded-*` posés par le proxy ;
 *   3. en dernier recours seulement, l'origine vue par Next.
 */
export function getBaseUrl(request: NextRequest): string {
  const configured = APP_URL;

  // En production, la valeur configurée fait foi — sauf si elle a été laissée
  // sur localhost, ce qui n'aurait aucun sens face à une requête distante.
  if (configured && !isLocal(configured)) {
    return configured.replace(/\/$/, '');
  }

  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (forwardedHost && !forwardedHost.startsWith('0.0.0.0')) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${forwardedHost}`.replace(/\/$/, '');
  }

  if (configured) return configured.replace(/\/$/, '');

  return request.nextUrl.origin.replace(/\/$/, '');
}

function isLocal(url: string): boolean {
  return url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0');
}

/**
 * Construit une URL absolue vers un chemin interne.
 * Refuse tout ce qui n'est pas un chemin relatif : sans ce garde-fou, un
 * paramètre `?redirect=` contrôlé par un tiers transformerait la page de
 * connexion en redirection ouverte, exploitable pour du hameçonnage depuis
 * notre propre domaine.
 */
export function absoluteUrl(request: NextRequest, path: string): string {
  const safePath = path.startsWith('/') && !path.startsWith('//') ? path : '/dashboard';
  return `${getBaseUrl(request)}${safePath}`;
}
