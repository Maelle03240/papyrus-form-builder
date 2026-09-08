'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2, Handshake } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getBackgroundStyle } from '@/lib/theme';
import { joinHeading } from '@/lib/partners';
import { pickText } from '@/lib/email/tokens';
import type { PublicPartnerJoin } from '@/types';

/**
 * Formulaire public « devenir partenaire ».
 *
 * Il enregistre une demande ; il n'ouvre aucun accès. C'est l'équipe qui ouvre
 * ensuite le portail depuis son annuaire — et l'écran le dit, plutôt que de
 * laisser croire à un accès immédiat qui n'arriverait jamais.
 *
 * mooove-invoice, lui, connecte le nouveau partenaire sur-le-champ. Ce n'est pas
 * transposable : le portail de Papyrus s'ouvre avec un vrai compte
 * d'authentification, et délivrer un accès à quiconque TAPE une adresse
 * donnerait le compte de n'importe qui à n'importe qui.
 */
export function PartnerJoinForm({ project }: { project: PublicPartnerJoin }) {
  const language = project.default_language || 'fr';
  const accent = project.project_theme?.accent || '#052139';

  const [form, setForm] = useState({ name: '', email: '', phone: '', website: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const message = pickText(project.partner_config.join_message, language);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/a/join/${project.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'La demande n’a pas pu être envoyée.');

      setSent(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'La demande n’a pas pu être envoyée.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--papyrus-bg)', ...getBackgroundStyle(project.project_theme) }}
    >
      <div className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-14">
        <div className="w-full rounded-2xl border border-border bg-bg-surface p-8 shadow-sm sm:p-10">
          {sent ? (
            <div className="text-center">
              <span
                className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
                style={{ backgroundColor: accent }}
              >
                <CheckCircle2 className="h-6 w-6 text-white" aria-hidden />
              </span>
              <h1 className="mt-5 font-display text-2xl font-bold text-text-primary">
                Demande enregistrée
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                L’équipe de {project.project_name} vous ouvrira votre espace
                partenaire et vous enverra votre lien de partage.
              </p>
            </div>
          ) : (
            <>
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl"
                style={{ backgroundColor: accent }}
              >
                <Handshake className="h-5 w-5 text-white" aria-hidden />
              </span>

              <h1 className="mt-5 font-display text-2xl font-bold leading-tight text-text-primary">
                {joinHeading(project.partner_config, project.project_name, language)}
              </h1>

              {message && (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-text-secondary">
                  {message}
                </p>
              )}

              <form onSubmit={handleSubmit} className="mt-7 space-y-4">
                <Input
                  id="join-name"
                  label="Nom ou raison sociale"
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
                <Input
                  id="join-email"
                  label="Adresse e-mail"
                  type="email"
                  required
                  maxLength={180}
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
                <Input
                  id="join-phone"
                  label="Téléphone"
                  hint="Facultatif"
                  maxLength={60}
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                />
                <Input
                  id="join-website"
                  label="Site web"
                  hint="Facultatif"
                  maxLength={200}
                  value={form.website}
                  onChange={(event) => setForm({ ...form, website: event.target.value })}
                />

                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}

                <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
                  Envoyer ma demande
                </Button>

                <p className="text-center text-xs text-text-tertiary">
                  Votre espace partenaire sera ouvert par l’équipe, qui vous
                  transmettra votre accès.
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
