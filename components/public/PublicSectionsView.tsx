'use client';

import { useState, useEffect } from 'react';
import type { Form, Field } from '@/types';
import type { ScoreResult } from '@/lib/scoring';
import { FormHeader } from '@/components/builder/FormHeader';
import { ScoreDisplay } from '@/components/respondent/ScoreDisplay';
import { PublicFieldCard } from './PublicFieldCard';
import { buildPages } from '@/lib/sections';
import { cn } from '@/lib/utils';
import { ArrowLeft, ArrowRight } from 'lucide-react';
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
}

export function PublicSectionsView({
  form,
  responses,
  updateResponse,
  visibleFields,
  onSubmit,
  isSubmitting,
  validateRequiredFields,
  scoreResult,
  showScoreToRespondent
}: Props) {
  const fields = form.fields?.filter(f => visibleFields.has(f.id)) || [];
  const pages = buildPages(fields);
  const [pageIdx, setPageIdx] = useState(0);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pageIdx]);

  const total = pages.length;
  const currentPage = pages[pageIdx] ?? [];
  const progress = total > 0 ? ((pageIdx + 1) / total) * 100 : 0;
  const isLast = pageIdx === total - 1;
  const isFirst = pageIdx === 0;

  const pageHeader = currentPage[0]?.type === 'section_break' ? currentPage[0] : null;
  const pageFields = pageHeader ? currentPage.slice(1) : currentPage;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isLast) {
      // Validation finale
      const validation = validateRequiredFields();
      if (!validation.isValid) {
        const fieldNames = validation.missingFields.map(f => f.label.fr || 'Champ sans nom').join(', ');
        toast.error(`Veuillez remplir les champs obligatoires : ${fieldNames}`);
        return;
      }

      await onSubmit();
    } else {
      // Aller à la page suivante
      setPageIdx(i => Math.min(total - 1, i + 1));
    }
  };

  return (
    <div className="min-h-screen">
      {/* Barre de progression */}
      <div className="sticky top-0 z-50 bg-white border-b border-border">
        <div
          className="h-2 bg-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
        <div className="px-8 py-4">
          <p className="text-sm text-text-secondary text-center">
            Page {pageIdx + 1} sur {total}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mx-auto max-w-2xl px-8 py-8">

        {/* Header de formulaire (seulement sur la première page) */}
        {isFirst && (
          <div className="mb-8">
            <FormHeader
              theme={form.theme}
              selectedElement={null}
              onSelectBanner={() => {}}
              onSelectLogo={() => {}}
              preview={true}
            />
            <header className="mb-8">
              <h1 className="font-display text-4xl text-text-primary">{form.title}</h1>
              {form.description && (
                <p
                  className="papyrus-meta mt-2 text-base"
                  style={{ color: form.theme.text_color ?? 'var(--text-secondary)' }}
                >
                  {form.description}
                </p>
              )}
            </header>
          </div>
        )}

        {/* Header de section */}
        {pageHeader && (
          <div className="mb-8">
            <h2 className="font-display text-2xl text-text-primary">
              {pageHeader.label.fr}
            </h2>
            {pageHeader.description.fr && (
              <p className="papyrus-meta mt-2 text-base">
                {pageHeader.description.fr}
              </p>
            )}
          </div>
        )}

        {/* Champs de la page courante */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {pageFields.map((field) => {
            const span = (field.layout_width ?? 'full') === 'full' ? 'col-span-2' : 'col-span-1';
            return (
              <PublicFieldCard
                key={field.id}
                field={field}
                form={form}
                span={span}
                responses={responses}
                updateResponse={updateResponse}
              />
            );
          })}
        </div>

        {/* Score (sur la dernière page) */}
        {isLast && showScoreToRespondent && scoreResult && scoreResult.maxScore > 0 && (
          <div className="mb-8">
            <ScoreDisplay
              scoreResult={scoreResult}
              scoreLabel={form.theme.score_label}
              scoreDescription={form.theme.score_description}
            />
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPageIdx(i => Math.max(0, i - 1))}
            disabled={isFirst}
            className={cn(
              'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition',
              isFirst
                ? 'text-text-tertiary cursor-not-allowed'
                : 'text-text-primary hover:bg-bg-elevated'
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Précédent
          </button>

          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              'flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium transition',
              'bg-accent text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isLast ? (
              isSubmitting ? 'Envoi...' : 'Envoyer'
            ) : (
              <>
                Suivant
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}