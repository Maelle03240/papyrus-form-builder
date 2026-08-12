'use client';

import type { Form } from '@/types';
import type { ScoreResult } from '@/lib/scoring';
import type { EmbedOptions } from '@/lib/embed';
import { FormHeader } from '@/components/builder/FormHeader';
import { ScoreDisplay } from '@/components/respondent/ScoreDisplay';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface Props {
  form: Form;
  submissionId: string | null;
  scoreResult?: ScoreResult;
  embed?: EmbedOptions;
}

export function ThankYouPage({ form, submissionId, scoreResult, embed }: Props) {
  const confirmationMessage = form.theme.score_description ||
    "Merci pour votre réponse ! Nous avons bien reçu vos informations.";

  return (
    <div
      className={cn(
        'flex items-center justify-center px-8 py-12',
        embed?.enabled ? 'min-h-[320px]' : 'min-h-screen'
      )}
    >
      <div className="mx-auto max-w-2xl text-center">

        {/* Header avec bannière et logo */}
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

        {/* Icône de succès */}
        <div
          className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full"
          style={{
            backgroundColor: form.theme.accent || '#052139',
          }}
        >
          <Check className="h-10 w-10 text-white" />
        </div>

        {/* Titre */}
        <h1 className="font-display text-3xl text-text-primary mb-4">
          Merci !
        </h1>

        {/* Message de confirmation */}
        <p className="text-lg text-text-secondary mb-8 leading-relaxed">
          {confirmationMessage}
        </p>

        {/* Affichage du score si activé */}
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

        {/* ID de soumission (optionnel, pour le debug) */}
        {submissionId && process.env.NODE_ENV === 'development' && (
          <p className="text-xs text-text-tertiary">
            ID de soumission : {submissionId}
          </p>
        )}

        {/* Message de fermeture — sans objet dans une iframe, où il n'y a pas de
            page à fermer. */}
        {!embed?.enabled && (
          <p className="text-sm text-text-tertiary mt-8">
            Vous pouvez fermer cette page.
          </p>
        )}
      </div>
    </div>
  );
}