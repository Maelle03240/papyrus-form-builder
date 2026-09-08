'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Handshake } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { createClient } from '@/lib/supabase/client';

/**
 * L'entrée du portail partenaire.
 *
 * Écran séparé de `/login` : le personnel se connecte à un espace de travail, un
 * partenaire à ses commissions, et les deux n'ont ni le même vocabulaire ni la
 * même suite. Les faire passer par la même porte obligerait à expliquer sur
 * l'écran de connexion du produit qu'il sert aussi à autre chose.
 *
 * Le même écran sert quand quelqu'un ouvre le portail d'un autre : il n'y a
 * aucune raison de lui dire que ce jeton existe.
 */
export function PartnerSignIn({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await createClient().auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (signInError) {
      // Générique, comme sur l'écran du personnel : distinguer « mot de passe
      // incorrect » de « compte inexistant » permettrait d'énumérer les comptes.
      setError('Adresse e-mail ou mot de passe incorrect.');
      setLoading(false);
      return;
    }

    router.push(redirectTo ?? '/p');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-mooove-navy text-mooove-ice">
            <Handshake className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="mt-5 font-display text-2xl font-bold text-text-primary">
            Espace partenaire
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Vos liens de partage, vos inscriptions et vos commissions.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <Input
            id="partner-email"
            label="Adresse e-mail"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            id="partner-password"
            label="Mot de passe"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            Se connecter
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-text-tertiary">
          Vous n’avez pas encore d’accès ? Demandez-le à l’équipe qui vous a
          transmis votre lien de partage.
        </p>
      </div>
    </div>
  );
}
