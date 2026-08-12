/** @type {import('next').NextConfig} */

/**
 * Politique de sécurité du contenu.
 *
 * `'unsafe-inline'` sur les styles est nécessaire : le builder applique les
 * thèmes de formulaire via des styles en ligne, et Tailwind injecte ses classes
 * au runtime. `'unsafe-eval'` n'est autorisé qu'en développement, pour le
 * rafraîchissement à chaud de Next.js.
 *
 * `connect-src` doit lister explicitement Supabase et R2 : sans cela, les appels
 * d'API et les téléversements présignés sont bloqués par le navigateur.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const mediaUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ?? 'https://media.mooove.ltd';
const isDev = process.env.NODE_ENV === 'development';

/**
 * Deux politiques d'intégration, pas une.
 *
 * Le tableau de bord ne doit être encadrable que par nos propres domaines : une
 * iframe hostile qui superpose ses boutons aux nôtres ferait supprimer un
 * formulaire d'un clic (détournement de clic).
 *
 * Les pages `/embed/…`, elles, existent précisément pour être intégrées au site
 * d'un client — la liste blanche n'a donc pas de sens : elle imposerait de
 * redéployer l'application à chaque nouveau client. Ces pages n'exposent aucune
 * action authentifiée : ce sont des formulaires publics, dont le seul effet est
 * d'enregistrer une réponse.
 */
const APP_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://*.mooove.group https://*.mooove.live https://*.mooove.club https://*.meetyourjob.com https://*.smarttraveller.mu https://*.careerhub.mu";

const EMBED_FRAME_ANCESTORS = 'frame-ancestors *';

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
  `img-src 'self' data: blob: ${mediaUrl} https://flagcdn.com ${supabaseUrl}`.trim(),
  `media-src 'self' blob: ${mediaUrl} ${supabaseUrl}`.trim(),
  `connect-src 'self' ${supabaseUrl} ${supabaseUrl.replace(/^https/, 'wss')} ${mediaUrl} https://*.r2.cloudflarestorage.com`.trim(),
  // Vidéos intégrées (YouTube, Vimeo) insérées par les créateurs de formulaires.
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests'
].join('; ');

/** Politique appliquée aux pages destinées à vivre dans le site d'un client. */
const embedContentSecurityPolicy = [contentSecurityPolicy, EMBED_FRAME_ANCESTORS].join('; ');

/** Politique appliquée à tout le reste — application, API, formulaires publics. */
const appContentSecurityPolicy = [contentSecurityPolicy, APP_FRAME_ANCESTORS].join('; ');

const nextConfig = {
  // Sortie autonome : image Docker minimale pour Easypanel.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,

  // Les erreurs TypeScript et ESLint étaient ignorées au build. Un projet qui
  // compile en masquant ses erreurs finit par livrer des pages cassées :
  // `npm run typecheck` passe désormais, la vérification est réactivée.
  eslint: {
    ignoreDuringBuilds: false
  },
  typescript: {
    ignoreBuildErrors: false
  },

  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist']
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'media.mooove.ltd' },
      { protocol: 'https', hostname: 'flagcdn.com' },
      ...(supabaseUrl
        ? [{ protocol: 'https', hostname: new URL(supabaseUrl).hostname }]
        : [])
    ]
  },

  async headers() {
    const commonHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
      },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload'
      }
    ];

    return [
      // Déclaré avant la règle générale : Next.js applique la première source qui
      // correspond, donc l'ordre décide laquelle des deux politiques s'applique.
      {
        source: '/embed/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: embedContentSecurityPolicy },
          ...commonHeaders
        ]
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: appContentSecurityPolicy },
          ...commonHeaders
        ]
      }
    ];
  }
};

export default nextConfig;
