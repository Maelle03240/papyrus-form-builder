'use client';

import type { Form, Field } from '@/types';
import type { ScoreResult } from '@/lib/scoring';
import type { EmbedOptions } from '@/lib/embed';
import { FormHeader } from '@/components/builder/FormHeader';
import {} from '@/components/builder/FieldRenderer';
import { ScoreDisplay } from '@/components/respondent/ScoreDisplay';
import { PublicFieldCard } from './PublicFieldCard';
import { PricingSummary } from './PricingSummary';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/components/ui/Toast';

interface Props {
  form: Form;
  responses: Record<string, any>;
  updateResponse: (fieldId: string, response: any) => void;
  visibleFields: Set<string>;
  onSubmit: () => Promise<void>;
  isSubmitting: boolean;
  validateRequiredFields: () => { isValid: boolean; missingFields: Field[] };
  scoreResult?: ScoreResult;
  showScoreToRespondent?: boolean;
  embed?: EmbedOptions;
}

export function PublicScrollView({
  form,
  responses,
  updateResponse,
  visibleFields,
  onSubmit,
  isSubmitting,
  validateRequiredFields,
  scoreResult,
  showScoreToRespondent,
  embed
}: Props) {
  const fields = form.fields?.filter(f => visibleFields.has(f.id)) || [];
  const hasInputs = fields.some(
    f => f.type !== 'image' && f.type !== 'video' && f.type !== 'statement'
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = validateRequiredFields();
    if (!validation.isValid) {
      const fieldNames = validation.missingFields.map(f => f.label.fr || 'Champ sans nom').join(', ');
      toast.error(`Veuillez remplir les champs obligatoires : ${fieldNames}`);
      return;
    }

    await onSubmit();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'max-w-2xl px-8',
        // Intégré dans un site tiers, le formulaire ne doit occuper que la place
        // dont il a besoin : la hauteur d'écran et les marges généreuses de la
        // page autonome laisseraient un grand vide dans la page hôte.
        embed?.enabled ? 'py-6' : 'min-h-screen py-12',
        embed?.alignLeft ? 'mr-auto' : 'mx-auto'
      )}
    >
      {/* Header avec bannière, logo et titre */}
      {!embed?.hideTitle && (
        <div className="mb-8">
          <FormHeader
            theme={form.theme}
            selectedElement={null}
            onSelectBanner={() => { }}
            onSelectLogo={() => { }}
            preview={true}
          />
          <header className="mb-8">
            <h1 className="font-display text-4xl text-text-primary">{form.title}</h1>
            {form.description && (
              <p
                className="papyrus-meta mt-2 text-base"
                style={{ color: form.theme.text_color ?? 'var(--fg-secondary)' }}
              >
                {form.description}
              </p>
            )}
          </header>
        </div>
      )}

      {/* Grille de champs */}
      <div className="grid grid-cols-2 gap-4">
        {fields.length === 0 && (
          <div className="col-span-2 rounded-lg border border-dashed border-border-strong bg-bg-surface p-12 text-center">
            <p className="papyrus-meta text-sm">Ce formulaire n&apos;a pas encore de champ visible</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {fields.map((field) => {
            const span = (field.layout_width ?? 'full') === 'full' ? 'col-span-2' : 'col-span-1';
            return (
              <motion.div
                key={field.id}
                layout
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className={span}
              >
                <PublicFieldCard
                  field={field}
                  form={form}
                  span="w-full"
                  responses={responses}
                  updateResponse={updateResponse}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Score de maturité */}
      {showScoreToRespondent && scoreResult && scoreResult.maxScore > 0 && (
        <div className="mt-8">
          <ScoreDisplay
            scoreResult={scoreResult}
            scoreLabel={form.theme.score_label}
            scoreDescription={form.theme.score_description}
          />
        </div>
      )}

      {/* Récapitulatif chiffré — juste avant l'envoi, là où l'on décide */}
      <div className="mt-8">
        <PricingSummary form={form} responses={responses} updateResponse={updateResponse} />
      </div>

      {/* Bouton de soumission */}
      {hasInputs && (
        <div className="mt-8 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              'rounded-xl px-6 py-3 text-sm font-medium transition',
              'bg-accent text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isSubmitting ? 'Envoi...' : 'Envoyer'}
          </button>
        </div>
      )}
    </form>
  );
}