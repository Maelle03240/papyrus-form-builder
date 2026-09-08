import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';
import { VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE } from '@/lib/visitor';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Rafraîchit la session Supabase à chaque requête.
 * Doit être appelé depuis middleware.ts à la racine du projet.
 */
export async function updateSession(request: NextRequest) {
  // Le cookie de visite est posé AVANT la création de la réponse, et il est
  // écrit sur la REQUÊTE autant que sur la réponse.
  //
  // Ne l'écrire que sur la réponse suffirait à le déposer chez le visiteur,
  // mais la page rendue au même instant, elle, ne le verrait pas : la toute
  // première visite d'un nouveau venu ne serait donc jamais comptée. Un
  // partenaire dont le lien amène une inscription lirait « 0 visite,
  // 1 inscription » — et conclurait, à raison, que le compteur est faux.
  const visitor = mintVisitor(request);

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
    // Programme partenaire. `/a/…` (page d'accueil, auto-inscription) est
    // entièrement public ; `/p/…` (portail) ne l'est qu'en apparence — la page
    // exige une session et vérifie elle-même que le jeton désigne bien le
    // partenaire connecté. La laisser passer ici lui permet d'afficher son
    // écran de connexion plutôt qu'une redirection vers celui du personnel.
    pathname.startsWith('/a/') ||
    pathname.startsWith('/p/') ||
    pathname.startsWith('/api/a/') ||
    pathname.startsWith('/api/submit') || // réception des réponses
    // Déverrouillage d'un formulaire protégé par mot de passe. Exact, et non
    // `startsWith('/api/forms')` : le reste de /api/forms gère les intégrations
    // d'un formulaire et doit rester réservé à ses propriétaires.
    pathname === '/api/forms/access' ||
    // Catalogue de modèles : contenu statique versionné dans le dépôt, aucune
    // donnée d'utilisateur, aucune requête Supabase — donc aucune surface RLS.
    pathname.startsWith('/api/templates') ||
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

  if (visitor) {
    response.cookies.set(VISITOR_COOKIE, visitor, {
      maxAge: VISITOR_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/a'
    });
  }

  /**
   * Un partenaire n'entre pas dans l'espace de travail.
   *
   * Sans cette redirection il y arriverait : il possède une session Supabase
   * valide, donc le middleware le laisse passer, et la RLS lui donne un tableau
   * de bord vide plutôt qu'une porte fermée. Un écran vide n'est pas un refus —
   * c'est une invitation à croire que quelque chose est cassé.
   *
   * Le rôle est lu dans `app_metadata`, que son titulaire ne peut pas modifier :
   * `user_metadata`, lui, est écrit par le client.
   */
  if (user && isStaffRoute(pathname) && isPartnerAccount(user)) {
    const url = request.nextUrl.clone();
    url.pathname = '/p';
    url.search = '';
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
 * Attribue un identifiant de visite aux pages d'accueil partenaire.
 *
 * Rien qu'un tirage au sort : aucune donnée personnelle, aucune reconnaissance
 * possible ailleurs, et une durée de vie d'une demi-heure — la fenêtre de
 * dédoublonnage des visites, pas une de plus. Renvoie la valeur à poser sur la
 * réponse, ou `null` quand il n'y a rien à faire.
 */
function mintVisitor(request: NextRequest): string | null {
  if (!request.nextUrl.pathname.startsWith('/a/')) return null;
  if (request.cookies.get(VISITOR_COOKIE)) return null;

  const value = crypto.randomUUID().replace(/-/g, '');
  request.cookies.set(VISITOR_COOKIE, value);
  return value;
}

/** Les pages réservées au personnel — celles qu'un partenaire ne doit pas voir. */
function isStaffRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/projects') ||
    pathname.startsWith('/forms') ||
    pathname.startsWith('/templates') ||
    pathname.startsWith('/workspaces') ||
    pathname.startsWith('/partners') ||
    pathname.startsWith('/contacts') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/billing')
  );
}

function isPartnerAccount(user: { app_metadata?: Record<string, unknown> | null }): boolean {
  return user.app_metadata?.papyrus_role === 'partner';
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
