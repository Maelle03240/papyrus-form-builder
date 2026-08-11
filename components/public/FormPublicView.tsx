'use client';

import { useState, useEffect } from 'react';
import type { Form } from '@/types';
import { toast } from '@/components/ui/Toast';
import { FormSlugProvider } from '@/lib/hooks/useFormSlug';
import { useFormScore } from '@/lib/hooks/useFormScore';
import { evaluateLogicRules } from '@/lib/logic-evaluation';
import { getBackgroundStyle } from '@/lib/theme';
import {} from '@/components/builder/FormHeader';
import { PublicScrollView } from './PublicScrollView';
import { PublicTypeformView } from './PublicTypeformView';
import { PublicSectionsView } from './PublicSectionsView';
import { ThankYouPage } from './ThankYouPage';

interface Props {
  form: Form;
}

export function FormPublicView({ form }: Props) {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Hook pour gérer le scoring en temps réel
  const {
    responses,
    scoreResult,
    updateResponse,
    showScoreToRespondent
  } = useFormScore(form);

  // États pour la logique conditionnelle
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());

  // Évaluer la visibilité des champs (changement de réponses, structure ou règles)
  useEffect(() => {
    const fields = form.fields || [];
    
    const newVisibleFields = evaluateLogicRules(
      form.logic_rules || [],
      responses,
      fields
    );

    setVisibleFields(newVisibleFields);
  }, [responses, form.logic_rules, form.fields]);

  // Soumission du formulaire
  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/submit/${form.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses,
          language: form.default_language || 'fr'
        })
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        // Le serveur renvoie un message exploitable (champ manquant, formulaire
        // fermé, quota atteint…) : l'afficher plutôt qu'une erreur générique.
        throw new Error(
          body?.error ??
            (response.status === 429
              ? 'Trop de tentatives. Patientez quelques instants avant de réessayer.'
              : "Une erreur est survenue lors de l'envoi. Veuillez réessayer.")
        );
      }

      // Nettoyer la sauvegarde locale du save & resume si activé
      if (form.save_and_resume) {
        localStorage.removeItem(`papyrus-progress-${form.id}`);
      }

      setSubmissionId(body?.submission_id ?? null);
      setIsSubmitted(true);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Une erreur est survenue lors de l'envoi. Veuillez réessayer.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Validation des champs requis
  const validateRequiredFields = () => {
    const fields = form.fields || [];
    const visibleRequiredFields = fields.filter(f =>
      f.required &&
      visibleFields.has(f.id) &&
      f.type !== 'section_break' &&
      f.type !== 'statement' &&
      f.type !== 'image' &&
      f.type !== 'video'
    );

    const missingFields = visibleRequiredFields.filter(f =>
      !responses[f.id] ||
      (typeof responses[f.id] === 'string' && (responses[f.id] as string).trim() === '')
    );

    return { isValid: missingFields.length === 0, missingFields };
  };

  // Propage l'accent du formulaire via CSS variables
  const accentStyle = { '--accent': form.theme.accent } as React.CSSProperties;

  // Page de remerciement après soumission
  if (isSubmitted) {
    return (
      <ThankYouPage
        form={form}
        submissionId={submissionId}
        scoreResult={showScoreToRespondent ? (scoreResult || undefined) : undefined}
      />
    );
  }

  return (
    <FormSlugProvider slug={form.slug}>
    <div
      className="min-h-screen"
      style={{
        background: 'var(--papyrus-bg)',
        ...accentStyle,
        ...getBackgroundStyle(form.theme)
      }}
    >
      {/* Mode d'affichage selon form.display_mode */}
      {form.display_mode === 'typeform' ? (
        <PublicTypeformView
          form={form}
          responses={responses}
          updateResponse={updateResponse}
          visibleFields={visibleFields}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          validateRequiredFields={validateRequiredFields}
          scoreResult={scoreResult || undefined}
          showScoreToRespondent={showScoreToRespondent}
        />
      ) : form.display_mode === 'sections' ? (
        <PublicSectionsView
          form={form}
          responses={responses}
          updateResponse={updateResponse}
          visibleFields={visibleFields}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          validateRequiredFields={validateRequiredFields}
          scoreResult={scoreResult || undefined}
          showScoreToRespondent={showScoreToRespondent}
        />
      ) : (
        <PublicScrollView
          form={form}
          responses={responses}
          updateResponse={updateResponse}
          visibleFields={visibleFields}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          validateRequiredFields={validateRequiredFields}
          scoreResult={scoreResult || undefined}
          showScoreToRespondent={showScoreToRespondent}
        />
      )}
    </div>
    </FormSlugProvider>
  );
}