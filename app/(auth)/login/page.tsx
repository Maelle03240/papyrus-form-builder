'use client';

import { useState, type FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';

/** Messages d'erreur renvoyés par /auth/callback, traduits pour l'utilisateur. */
const CALLBACK_ERRORS: Record<string, string> = {
  domain_not_allowed:
    "Votre adresse email n'appartient pas à un domaine autorisé sur cet espace Papyrus. Contactez un administrateur.",
  signup_closed:
    'Les inscriptions sont fermées. Demandez une invitation à un administrateur.',
  invalid_email: "Ce compte Google n'expose pas d'adresse email utilisable.",
  exchange_failed: 'La session n’a pas pu être ouverte. Réessayez.',
  missing_code: 'Lien de connexion incomplet ou expiré.'
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const redirect = safeRedirect(searchParams.get('redirect'));
  const callbackError = searchParams.get('error');
  const [error, setError] = useState<string | null>(
    callbackError ? (CALLBACK_ERRORS[callbackError] ?? 'La connexion a échoué.') : null
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      // Message volontairement générique : distinguer « mot de passe incorrect »
      // de « compte inexistant » permettrait d'énumérer les comptes.
      setError('Email ou mot de passe incorrect.');
      setLoading(false);
      return;
    }

    router.push(redirect);
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-display text-3xl font-bold">Connexion à Papyrus</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Le form builder de Mooove.
        </p>
      </div>

      <GoogleSignInButton redirectTo={redirect} label="Se connecter avec Google" />

      <div className="my-6 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wider text-text-tertiary">ou</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          type="email"
          name="email"
          label="Email"
          placeholder="vous@mooove.live"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          type="password"
          name="password"
          label="Mot de passe"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger"
          >
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" loading={loading}>
          Se connecter
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        Pas encore de compte ?{' '}
        <Link href="/signup" className="font-medium text-accent-bold underline-offset-4 hover:underline">
          Créer un compte
        </Link>
      </p>
    </div>
  );
}

/** N'autorise qu'un chemin interne — évite de servir de redirection ouverte. */
function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-sm text-center">
          <p className="papyrus-meta text-sm">Chargement…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
