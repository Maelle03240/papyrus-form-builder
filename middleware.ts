import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Rafraîchit la session Supabase et protège les routes privées.
 *
 * Ce middleware commençait par `if (IS_LOCAL_MODE) return NextResponse.next()`,
 * ce qui désactivait toute authentification dès que NEXT_PUBLIC_LOCAL_MODE valait
 * « true ». Une variable d'environnement oubliée dans la configuration Easypanel
 * suffisait donc à publier l'application entière sans connexion. Le mode local a
 * été supprimé : il n'existe plus de chemin qui contourne l'authentification.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Toutes les routes sauf :
     *  - les fichiers statiques Next.js et les images optimisées ;
     *  - le favicon et les fichiers d'exploration des robots ;
     *  - les fichiers servis depuis /public (extensions courantes).
     *
     * Les routes publiques applicatives (/f/…, /api/submit/…) sont bien
     * traversées : c'est `updateSession` qui décide de les laisser passer, ce
     * qui garantit un seul endroit où cette liste est définie.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)'
  ]
};
