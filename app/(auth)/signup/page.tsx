'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { getBaseUrl } from '@/lib/utils';

/** Longueur minimale imposée aussi côté Supabase Auth. */
const MIN_PASSWORD_LENGTH = 12;

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
      return;
    }

    setLoading(true);

    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { team_name: 'Mon espace' },
        // Le contrôle des domaines autorisés est appliqué dans /auth/callback.
        emailRedirectTo: `${getBaseUrl()}/auth/callback`
      }
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Si la confirmation par email est désactivée, la session existe déjà.
    if (data.session) {
      router.replace('/dashboard');
      return;
    }

    setEmailSent(true);
    setLoading(false);
  }

  if (emailSent) {
    return (
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-cta/10">
            <Mail className="h-8 w-8 text-accent-cta" />
          </div>
          <h1 className="font-display text-3xl font-bold">Confirmez votre email</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Un lien de confirmation a été envoyé à <strong>{email}</strong>.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-bg-surface p-4 text-sm">
          <p className="mb-2 font-medium">Prochaines étapes</p>
          <ol className="list-inside list-decimal space-y-1 text-text-secondary">
            <li>Ouvrez votre boîte mail</li>
            <li>Cliquez sur le lien de confirmation</li>
            <li>Votre compte est activé, vous arrivez sur Papyrus</li>
          </ol>
        </div>

        <Button onClick={() => setEmailSent(false)} variant="ghost" className="mt-4 w-full">
          Retour à l&apos;inscription
        </Button>

        <p className="mt-6 text-center text-sm text-text-secondary">
          Déjà un compte ?{' '}
          <Link href="/login" className="font-medium text-accent-bold underline-offset-4 hover:underline">
            Se connecter
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-display text-3xl font-bold">Créez votre Papyrus.</h1>
        <p className="mt-2 text-sm text-text-secondary">
          L&apos;accès est réservé aux domaines email autorisés par votre administrateur.
        </p>
      </div>

      <GoogleSignInButton label="S'inscrire avec Google" />

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
          autoComplete="email"
          placeholder="vous@mooove.live"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          type="password"
          name="password"
          label="Mot de passe"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`${MIN_PASSWORD_LENGTH} caractères minimum`}
          minLength={MIN_PASSWORD_LENGTH}
        />

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger"
          >
            {error}
          </div>
        )}

        <Button type="submit" variant="cta" className="w-full" loading={loading}>
          Créer mon compte
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        Déjà un compte ?{' '}
        <Link href="/login" className="font-medium text-accent-bold underline-offset-4 hover:underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
