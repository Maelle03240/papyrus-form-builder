'use client';

import { Check } from 'lucide-react';

import type { ConfirmationConfig, Form } from '@/types';
import type { ScoreResult } from '@/lib/scoring';
import type { EmbedOptions } from '@/lib/embed';
import { FormHeader } from '@/components/builder/FormHeader';
import { ScoreDisplay } from '@/components/respondent/ScoreDisplay';
import { pickText, renderTemplate } from '@/lib/email/tokens';
import { cn } from '@/lib/utils';

/**
 * Le dernier écran du parcours.
 *
 * Il est configurable depuis l'onglet « E-mails », parce qu'il se rédige avec le
 * message de confirmation : un écran qui annonce « un e-mail vient de partir »
 * alors qu'aucun n'est configuré est le genre d'incohérence qu'on ne voit qu'en
 * séparant les deux réglages.
 *
 * Non configuré, il dit ce qu'il a toujours dit. C'est délibéré : les
 * formulaires existants ne doivent pas se retrouver avec un écran vide parce
 * qu'une colonne est apparue.
 */

interface Props {
  form: Form;
  submissionId: string | null;
  /** Numéro attribué à l'envoi, quand le projet en attribue un. */
  invoiceNumber?: string | null;
  /** Réponses envoyées — les jetons `{{…}}` du message s'y résolvent. */
  responses?: Record<string, unknown>;
  scoreResult?: ScoreResult;
  embed?: EmbedOptions;
}

export function ThankYouPage({
  form,
  submissionId,
  invoiceNumber,
  responses,
  scoreResult,
  embed
}: Props) {
  const config = (form.confirmation_config ?? {}) as ConfirmationConfig;
  const language = form.default_language || 'fr';

  const resolve = (template: string) =>
    template
      ? renderTemplate(template, {
          form,
          responses: responses ?? {},
          submittedAt: new Date().toISOString(),
          invoiceNumber
        })
      : '';

  const title = resolve(pickText(config.title, language)) || 'Merci !';
  const message =
    resolve(pickText(config.message, language)) ||
    form.theme.score_description ||
    'Merci pour votre réponse ! Nous avons bien reçu vos informations.';

  const note = resolve(pickText(config.email_note, language));
  const referenceLabel =
    pickText(config.reference_label, language) || 'Votre numéro de commande';
  const showReference = Boolean(invoiceNumber) && config.show_reference !== false;

  const buttonLabel = pickText(config.button_label, language);
  const buttonUrl = safeUrl(config.button_url);

  return (
    <div
      className={cn(
        'flex items-center justify-center px-8 py-12',
        embed?.enabled ? 'min-h-[320px]' : 'min-h-screen'
      )}
    >
      <div className="mx-auto max-w-2xl text-center">
        {!embed?.hideTitle && (
          <div className="mb-8">
            <FormHeader
              theme={form.theme}
              selectedElement={null}
              onSelectBanner={() => {}}
              onSelectLogo={() => {}}
              preview={true}
            />
          </div>
        )}

        <div
          className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full"
          style={{ backgroundColor: form.theme.accent || '#052139' }}
        >
          <Check className="h-10 w-10 text-white" />
        </div>

        <h1 className="mb-4 font-display text-3xl text-text-primary">{title}</h1>

        <p className="mb-8 text-lg leading-relaxed text-text-secondary">{message}</p>

        {/* Le numéro est ce que le répondant citera s'il vous écrit : il se lit
            d'un coup d'œil et se recopie sans erreur, donc en chasse fixe. */}
        {showReference && (
          <div className="mx-auto mb-8 inline-block rounded-xl border border-border bg-bg-surface px-6 py-4">
            <p className="text-xs uppercase tracking-wide text-text-tertiary">
              {referenceLabel}
            </p>
            <p className="mt-1 font-mono text-xl font-bold tabular-nums text-text-primary">
              {invoiceNumber}
            </p>
          </div>
        )}

        {note && <p className="mb-8 text-sm text-text-secondary">{note}</p>}

        {scoreResult && scoreResult.maxScore > 0 && (
          <div className="mb-8">
            <ScoreDisplay
              scoreResult={scoreResult}
              scoreLabel={form.theme.score_label}
              scoreDescription={form.theme.score_description}
              scoreLevels={form.theme.score_levels}
            />
          </div>
        )}

        {buttonLabel && buttonUrl && (
          <a
            href={buttonUrl}
            // Une iframe ne doit pas détourner la page qui l'héberge.
            {...(embed?.enabled ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="inline-flex items-center rounded-md px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
            style={{ backgroundColor: form.theme.accent || '#052139' }}
          >
            {buttonLabel}
          </a>
        )}

        {submissionId && process.env.NODE_ENV === 'development' && (
          <p className="mt-8 text-xs text-text-tertiary">ID de soumission : {submissionId}</p>
        )}

        {!embed?.enabled && !buttonUrl && (
          <p className="mt-8 text-sm text-text-tertiary">Vous pouvez fermer cette page.</p>
        )}
      </div>
    </div>
  );
}

/**
 * N'autorise que `http` et `https`.
 *
 * L'adresse est saisie par l'auteur du formulaire, mais elle est cliquée dans le
 * navigateur du répondant : un `javascript:` enregistré en base y serait une
 * faille XSS stockée.
 */
function safeUrl(candidate: string | undefined): string | null {
  if (!candidate?.trim()) return null;
  try {
    const url = new URL(candidate.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
