import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Rafraîchit la session Supabase à chaque requête.
 * Doit être appelé depuis middleware.ts à la racine du projet.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        }
      }
    }
  );

  // IMPORTANT: ne rien insérer entre createServerClient et getUser.
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isAuthRoute =
    pathname.startsWith('/login') || pathname.startsWith('/signup') || pathname.startsWith('/confirm');

  /**
   * Routes accessibles sans session.
   *
   * Volontairement énumérées ici plutôt que dans `middleware.ts` : une seule
   * liste, au même endroit que la vérification, évite qu'un chemin soit exempté
   * d'authentification sans que ce soit visible.
   */
  const isPublicRoute =
    pathname === '/' ||
    pathname.startsWith('/f/') || // formulaires publics
    pathname.startsWith('/embed/') || // même formulaire, rendu pour une iframe
    pathname === '/embed.js' || // script d'intégration chargé par les sites hôtes
    pathname.startsWith('/invite/') || // acceptation d'invitation
    pathname.startsWith('/api/submit') || // réception des réponses
    // Déverrouillage d'un formulaire protégé par mot de passe. Exact, et non
    // `startsWith('/api/forms')` : le reste de /api/forms gère les intégrations
    // d'un formulaire et doit rester réservé à ses propriétaires.
    pathname === '/api/forms/access' ||
    pathname.startsWith('/api/check-duplicate') ||
    pathname.startsWith('/api/uploads') || // valide lui-même ses appelants
    pathname.startsWith('/api/health') || // sonde de vie Docker / Uptime Kuma
    pathname.startsWith('/auth/') || // callback OAuth
    isAuthRoute;

  if (!user && !isPublicRoute) {
    // Les routes d'API répondent 401 : les rediriger vers /login renverrait du
    // HTML à un appel `fetch`, qui échouerait ensuite au parsing JSON.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // En-têtes de sécurité appliqués à toute réponse traversant le middleware.
  applySecurityHeaders(response.headers);

  return response;
}

/**
 * En-têtes de sécurité communs.
 *
 * `X-Frame-Options` n'est pas posé ici : les formulaires publics doivent rester
 * intégrables en iframe sur les sites des marques. La protection contre le
 * détournement de clic pour les pages authentifiées passe par la CSP définie
 * dans next.config.mjs, qui distingue les deux cas.
 */
function applySecurityHeaders(headers: Headers): void {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-DNS-Prefetch-Control', 'off');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
}
