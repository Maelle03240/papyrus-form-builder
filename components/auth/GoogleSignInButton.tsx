'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from '@/components/ui/Toast';

interface Props {
  /** Chemin interne vers lequel revenir une fois connecté. */
  redirectTo?: string;
  label?: string;
}

/**
 * Connexion via Google.
 *
 * Le bouton n'ouvre que le flux OAuth : le droit d'entrer est décidé côté
 * serveur, dans /auth/callback, en fonction des domaines email autorisés.
 */
export function GoogleSignInButton({ redirectTo = '/dashboard', label = 'Continuer avec Google' }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const supabase = createClient();
      const callbackUrl = new URL('/auth/callback', window.location.origin);
      callbackUrl.searchParams.set('redirect', redirectTo);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl.toString(),
          queryParams: {
            // `consent` garantit qu'un refresh token est bien émis, y compris
            // lors d'une reconnexion ultérieure.
            access_type: 'offline',
            prompt: 'consent'
          }
        }
      });

      if (error) throw error;
      // Succès : le navigateur part chez Google, on garde l'état « chargement ».
    } catch (error) {
      console.error('Google sign-in error:', error);
      toast.error("La connexion Google n'a pas pu démarrer. Réessayez.");
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-border-strong bg-bg-surface px-4 text-sm font-semibold text-text-primary transition hover:border-accent-cta hover:bg-bg-elevated disabled:cursor-wait disabled:opacity-60"
    >
      <GoogleLogo />
      {loading ? 'Redirection…' : label}
    </button>
  );
}

/** Logo Google officiel, aux couleurs de marque imposées par Google. */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
