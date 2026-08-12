'use client';

import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { FormHeader } from '@/components/builder/FormHeader';
import { getBackgroundStyle } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { EmbedOptions } from '@/lib/embed';
import type { PublicForm } from '@/lib/public-form';
import { FormPublicView } from './FormPublicView';

/**
 * Écran de saisie du mot de passe.
 *
 * Le formulaire reçu du serveur ne contient aucune question : le contenu n'est
 * livré qu'en réponse à `/api/forms/access`, une fois le mot de passe validé.
 * L'écran n'est donc pas un simple rideau posé devant un contenu déjà chargé.
 *
 * Le jeton renvoyé accompagne ensuite l'envoi de la réponse, pour que le serveur
 * puisse refuser une soumission fabriquée sans être passée par ici.
 */
export function PasswordGate({
  form,
  embed
}: {
  form: PublicForm;
  embed?: EmbedOptions;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [unlocked, setUnlocked] = useState<{ form: PublicForm; token: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (checking || !password) return;

    setChecking(true);
    setError(null);

    try {
      const response = await fetch('/api/forms/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: form.slug, password })
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? 'Mot de passe incorrect.');
      }

      setUnlocked({ form: body.form as PublicForm, token: body.accessToken as string });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Mot de passe incorrect.');
      setPassword('');
    } finally {
      setChecking(false);
    }
  }

  if (unlocked) {
    return <FormPublicView form={unlocked.form} embed={embed} accessToken={unlocked.token} />;
  }

  return (
    <div
      className={cn('flex items-center justify-center px-6 py-16', embed?.enabled ? 'min-h-[360px]' : 'min-h-screen')}
      style={
        embed?.transparentBackground
          ? undefined
          : { background: 'var(--papyrus-bg)', ...getBackgroundStyle(form.theme) }
      }
    >
      <div className="w-full max-w-md text-center">
        {!embed?.hideTitle && (
          <FormHeader
            theme={form.theme}
            selectedElement={null}
            onSelectBanner={() => {}}
            onSelectLogo={() => {}}
            preview
          />
        )}

        <div
          className="mx-auto mb-6 mt-6 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: form.theme.accent || '#052139' }}
        >
          <KeyRound className="h-6 w-6 text-white" />
        </div>

        <h1 className="font-display text-2xl text-text-primary">{form.title}</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Ce formulaire est protégé. Saisissez le mot de passe qui vous a été communiqué.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            autoComplete="off"
            aria-label="Mot de passe"
            aria-invalid={error !== null}
            placeholder="Mot de passe"
            className="h-11 w-full rounded-xl border border-border-strong bg-bg-surface px-4 text-center text-sm text-text-primary focus:border-accent focus:outline-none"
          />

          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={checking || !password}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: form.theme.accent || '#052139' }}
          >
            {checking && <Loader2 className="h-4 w-4 animate-spin" />}
            {checking ? 'Vérification…' : 'Accéder au formulaire'}
          </button>
        </form>
      </div>
    </div>
  );
}
