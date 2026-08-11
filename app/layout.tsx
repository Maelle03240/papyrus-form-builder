import type { Metadata, Viewport } from 'next';
import { DM_Sans } from 'next/font/google';
import './globals.css';
import { ToastContainer } from '@/components/ui/Toast';

/**
 * DM Sans est le substitut libre d'Aktiv Grotesk, la police de l'identité
 * Mooove (Aktiv Grotesk est distribuée par Adobe Fonts, sous licence payante).
 * Si un kit Typekit est ajouté au projet, la chaîne de fallback définie dans
 * globals.css fera basculer le rendu sur Aktiv Grotesk sans autre changement.
 *
 * Deux poids seulement, conformément à la charte : « une seule famille
 * typographique, deux poids, zéro compromis ».
 */
const aktivSubstitute = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-aktiv',
  display: 'swap'
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#052139'
};

export const metadata: Metadata = {
  title: {
    default: 'Papyrus — Form Builder',
    template: '%s · Papyrus'
  },
  description:
    'Créez des formulaires beaux, simples et puissants. Papyrus, le form builder de Mooove.',
  applicationName: 'Papyrus',
  robots: {
    // Outil interne : aucune raison d'être indexé. Les formulaires publics
    // définissent leurs propres métadonnées dans /f/[slug].
    index: false,
    follow: false
  },
  icons: { icon: '/favicon.ico' }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={aktivSubstitute.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-bg-base font-sans text-text-primary antialiased">
        {children}
        <ToastContainer />
      </body>
    </html>
  );
}
