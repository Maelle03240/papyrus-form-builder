'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Handshake } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { createClient } from '@/lib/supabase/client';

/**
 * Première visite d'un partenaire, au bout de son lien d'invitation.
 *
 * Le lien d'invitation Supabase ouvre une session mais ne pose aucun mot de
 * passe : sans cet écran, le partenaire arriverait sur son portail une fois, et
 * ne pourrait jamais y revenir — il faudrait lui réémettre un lien à chaque
 * consultation.
 *
 * L'écran de confirmation du personnel n'est pas réutilisé : il renvoie vers le
 * tableau de bord, où un partenaire n'a rien à faire.
 */
function Welcome() {
  const router = useRouter();
  const params = useSearchParams();
  const portal = params.get('portal');

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // `detectSessionInUrl` traite le fragment du lien d'invitation dès le
    // chargement du client ; on attend seulement d'avoir la session pour
    // afficher le formulaire, sans quoi `updateUser` échouerait sans raison
    // visible.
    let cancelled = false;

    void (async () => {
      const {
        data: { session }
      } = await createClient().auth.getSession();
      if (!cancelled) {
        setReady(Boolean(session));
        if (!session) {
          setError(
            'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau à l’équipe.'
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (password.length < 8) {
      setError('Choisissez un mot de passe d’au moins 8 caractères.');
      return;
    }
    if (password !== confirmation) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);
    setError(null);

    const { error: updateError } = await createClient().auth.updateUser({ password });

    if (updateError) {
      setError('Le mot de passe n’a pas pu être enregistré. Réessayez.');
      setLoading(false);
      return;
    }

    router.push(portal ? `/p/${portal}` : '/p');
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
            Bienvenue
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Choisissez un mot de passe : il vous servira à revenir sur votre
            espace quand vous voudrez.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <Input
            id="partner-new-password"
            label="Mot de passe"
            type="password"
            autoComplete="new-password"
            required
            disabled={!ready}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Input
            id="partner-new-password-confirm"
            label="Confirmation"
            type="password"
            autoComplete="new-password"
            required
            disabled={!ready}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            disabled={!ready}
            className="w-full"
          >
            Accéder à mon espace
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function PartnerWelcomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-base" />}>
      <Welcome />
    </Suspense>
  );
}
