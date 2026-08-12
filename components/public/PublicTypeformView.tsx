'use client';

import { useState, useEffect, useRef } from 'react';
import { evaluateConditions } from '@/lib/logic-evaluation';
import type { Form, Field } from '@/types';
import type { ScoreResult } from '@/lib/scoring';
import type { EmbedOptions } from '@/lib/embed';
import { FormHeader } from '@/components/builder/FormHeader';
import { ScoreDisplay } from '@/components/respondent/ScoreDisplay';
import { FieldRenderer } from '@/components/builder/FieldRenderer';
import { PublicFieldCard } from './PublicFieldCard';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ArrowRight, Check } from 'lucide-react';
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

export function PublicTypeformView({
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
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    // Faire défiler la page hôte à chaque question serait intrusif.
    if (embed?.enabled) return;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [currentIdx, embed?.enabled]);

  /** En mode intégré, l'iframe n'a pas la hauteur de l'écran : on s'y adapte. */
  const screenClass = embed?.enabled ? 'min-h-[420px]' : 'min-h-screen';

  const [showIntro, setShowIntro] = useState(true);
  const [history, setHistory] = useState<string[]>([]);

  const total = fields.length;
  const currentField = fields[currentIdx];
  const progress = total > 0 ? ((currentIdx + 1) / total) * 100 : 0;
  const isLast = currentIdx === total - 1;

  // Validation de champ individuel
  const validateCurrentField = () => {
    if (!currentField || !currentField.required) return true;

    const value = responses[currentField.id];
    return value !== undefined && value !== null &&
      (typeof value !== 'string' || value.trim() !== '');
  };

  const handleBack = () => {
    if (history.length > 0) {
      const prevId = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));
      const prevIdx = fields.findIndex(f => f.id === prevId);
      if (prevIdx !== -1) {
        setCurrentIdx(prevIdx);
      } else {
        setCurrentIdx(i => Math.max(0, i - 1));
      }
    } else {
      setCurrentIdx(i => Math.max(0, i - 1));
    }
  };

  const handleNext = async () => {
    // Validation du champ courant
    if (!validateCurrentField()) {
      toast.error('Ce champ est obligatoire');
      return;
    }

    // Trouver s'il y a une règle de type jump_to ou end_form qui concerne le champ courant
    const fieldRules = (form.logic_rules ?? [])
      .filter((r) => r.conditions && r.conditions.some(c => c.source_field_id === currentField.id))
      .sort((a, b) => (a.rule_order || 0) - (b.rule_order || 0));

    let triggeredAction: { action_type: string; target_field_id?: string } | null = null;

    for (const rule of fieldRules) {
      if (evaluateConditions(rule.conditions, rule.conditions_operator || 'AND', responses)) {
        triggeredAction = rule;
        break; // Première règle valide trouvée
      }
    }

    if (triggeredAction) {
      if (triggeredAction.action_type === 'end_form') {
        // Soumission finale immédiate
        const validation = validateRequiredFields();
        if (!validation.isValid) {
          toast.error('Veuillez remplir tous les champs obligatoires');
          return;
        }
        await onSubmit();
        return;
      }

      if (triggeredAction.action_type === 'jump_to' && triggeredAction.target_field_id) {
        let targetIdx = fields.findIndex(f => f.id === triggeredAction!.target_field_id);
        if (targetIdx === -1) {
          // Si la cible n'est pas visible, on cherche le premier champ visible APRES la cible dans le formulaire original
          const targetFieldInForm = form.fields?.find(f => f.id === triggeredAction!.target_field_id);
          if (targetFieldInForm) {
            targetIdx = fields.findIndex(f => f.field_order >= targetFieldInForm.field_order);
          }
        }
        if (targetIdx !== -1) {
          setHistory(prev => [...prev, currentField.id]);
          setCurrentIdx(targetIdx);
          return;
        }
      }
    }

    if (isLast) {
      // Soumission finale
      const validation = validateRequiredFields();
      if (!validation.isValid) {
        toast.error('Veuillez remplir tous les champs obligatoires');
        return;
      }
      await onSubmit();
    } else {
      // Question suivante
      setHistory(prev => [...prev, currentField.id]);
      setCurrentIdx(i => Math.min(total - 1, i + 1));
    }
  };

  const handleAutoAdvance = () => {
    if (!currentField) return;

    // Validation du champ courant
    if (!validateCurrentField()) {
      return;
    }

    // Trouver s'il y a une règle de type jump_to ou end_form qui concerne le champ courant
    const fieldRules = (form.logic_rules ?? [])
      .filter((r) => r.conditions && r.conditions.some(c => c.source_field_id === currentField.id))
      .sort((a, b) => (a.rule_order || 0) - (b.rule_order || 0));

    let triggeredAction: { action_type: string; target_field_id?: string } | null = null;

    for (const rule of fieldRules) {
      if (evaluateConditions(rule.conditions, rule.conditions_operator || 'AND', responses)) {
        triggeredAction = rule;
        break; // Première règle valide trouvée
      }
    }

    if (triggeredAction) {
      if (triggeredAction.action_type === 'end_form') {
        // En auto-advance, on ne soumet pas automatiquement le formulaire pour laisser l'utilisateur cliquer sur Envoyer
        return;
      }

      if (triggeredAction.action_type === 'jump_to' && triggeredAction.target_field_id) {
        let targetIdx = fields.findIndex(f => f.id === triggeredAction!.target_field_id);
        if (targetIdx === -1) {
          const targetFieldInForm = form.fields?.find(f => f.id === triggeredAction!.target_field_id);
          if (targetFieldInForm) {
            targetIdx = fields.findIndex(f => f.field_order >= targetFieldInForm.field_order);
          }
        }
        if (targetIdx !== -1) {
          setHistory(prev => [...prev, currentField.id]);
          setCurrentIdx(targetIdx);
          return;
        }
      }
    }

    // Si pas d'action spécifique, on avance à la question suivante seulement s'il y en a une
    const isLastField = currentIdx === fields.length - 1;
    if (!isLastField) {
      setHistory(prev => [...prev, currentField.id]);
      setCurrentIdx(i => i + 1);
    }
  };

  const handleNextRef = useRef(handleNext);
  const handleAutoAdvanceRef = useRef(handleAutoAdvance);
  useEffect(() => {
    handleNextRef.current = handleNext;
    handleAutoAdvanceRef.current = handleAutoAdvance;
  });

  // Navigation par clavier
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !isSubmitting) {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIdx, responses, isSubmitting]);

  /*
   * Les écrans d'intro et « aucune question » sont rendus APRÈS tous les Hooks.
   *
   * L'intro sortait auparavant en `return` anticipé placé avant les `useRef` et
   * `useEffect` ci-dessus : les Hooks n'étaient donc pas appelés tant que l'écran
   * d'accueil était affiché, puis apparaissaient d'un coup au clic sur
   * « Commencer ». React refuse ce changement de nombre de Hooks entre deux
   * rendus et fait planter la page — exactement au moment où le répondant
   * démarrait le formulaire.
   */
  if (showIntro) {
    return (
      <div className={cn(screenClass, 'flex items-center justify-center px-8 py-10')}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'max-w-2xl',
            embed?.alignLeft ? 'mr-auto text-left' : 'mx-auto text-center'
          )}
        >
          {!embed?.hideTitle && (
            <>
              <FormHeader
                theme={form.theme}
                selectedElement={null}
                onSelectBanner={() => {}}
                onSelectLogo={() => {}}
                preview={true}
              />

              <div className="mb-8">
                <h1 className="font-display text-4xl text-text-primary mb-4">{form.title}</h1>
                {form.description && (
                  <p
                    className="text-lg leading-relaxed"
                    style={{ color: form.theme.text_color ?? 'var(--text-secondary)' }}
                  >
                    {form.description}
                  </p>
                )}
              </div>
            </>
          )}

          <button
            onClick={() => setShowIntro(false)}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl px-8 py-4 text-lg font-medium transition',
              'bg-accent text-white hover:opacity-90'
            )}
          >
            Commencer
            <ArrowRight className="h-5 w-5" />
          </button>

          <p className="text-sm text-text-tertiary mt-6">
            {total} question{total > 1 ? 's' : ''} · Appuyez sur Entrée pour avancer
          </p>
        </motion.div>
      </div>
    );
  }

  if (!currentField) {
    return (
      <div className={cn(screenClass, 'flex items-center justify-center')}>
        <p>Aucune question disponible</p>
      </div>
    );
  }

  return (
    <div className={cn(screenClass, 'relative')}>
      {/* Barre de progression — `absolute` en mode intégré : `fixed` la collerait
          au haut de la fenêtre du visiteur, pas à celui de l'iframe. */}
      <div className={cn('left-0 right-0 top-0 z-50', embed?.enabled ? 'absolute' : 'fixed')}>
        <div
          className="h-1 bg-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Numéro de question */}
      <div className={cn('right-4 top-4 z-40', embed?.enabled ? 'absolute' : 'fixed')}>
        <span className="text-sm text-text-tertiary">
          {currentIdx + 1} / {total}
        </span>
      </div>

      <div className={cn(screenClass, 'flex items-center justify-center px-8 py-12')}>
        <div className={cn('w-full max-w-2xl', embed?.alignLeft ? 'mr-auto' : 'mx-auto')}>

          <AnimatePresence mode="wait">
            <motion.div
              key={currentField.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >

              {/* Question */}
              <div className="mb-8">
                <h2 className="font-display text-3xl text-text-primary mb-4">
                  <span className="text-accent mr-2">
                    {currentIdx + 1}.
                  </span>
                  {currentField.label.fr}
                  {currentField.required && (
                    <span className="text-red-500 ml-2">*</span>
                  )}
                </h2>

                {currentField.description.fr && (
                  <p className="text-lg text-text-secondary leading-relaxed">
                    {currentField.description.fr}
                  </p>
                )}
              </div>

              {/* Champ de saisie */}
              <div className="mb-8">
                {currentField.type === 'section_break' ||
                  currentField.type === 'statement' ||
                  currentField.type === 'image' ||
                  currentField.type === 'video' ? (
                  <PublicFieldCard
                    field={currentField}
                    form={form}
                    span="col-span-2"
                    responses={responses}
                    updateResponse={updateResponse}
                  />
                ) : (
                  <FieldRenderer
                    field={currentField}
                    preview={false}
                    mobile={false}
                    value={responses[currentField.id]}
                    onValueChange={(val) => {
                      updateResponse(currentField.id, val);
                      if (currentField.type === 'single_choice' && val !== '__other__') {
                        setTimeout(() => {
                          handleAutoAdvanceRef.current();
                        }, 300);
                      }
                    }}
                  />
                )}
              </div>

              {/* Score sur dernière question */}
              {isLast && showScoreToRespondent && scoreResult && scoreResult.maxScore > 0 && (
                <div className="mb-8">
                  <ScoreDisplay
                    scoreResult={scoreResult}
                    scoreLabel={form.theme.score_label}
                    scoreDescription={form.theme.score_description}
                  />
                </div>
              )}

              {/* Boutons de navigation */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={currentIdx === 0 && history.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-surface px-6 py-3 text-lg font-medium transition hover:border-border-strong disabled:opacity-50 disabled:cursor-not-allowed text-text-primary"
                >
                  Retour
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={isSubmitting}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-xl px-6 py-3 text-lg font-medium transition',
                    'bg-accent text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  {isLast ? (
                    isSubmitting ? (
                      'Envoi...'
                    ) : (
                      <>
                        <Check className="h-5 w-5" />
                        Envoyer
                      </>
                    )
                  ) : (
                    <>
                      Suivant
                      <ArrowRight className="h-5 w-5" />
                    </>
                  )}
                </button>
              </div>

              <p className="text-sm text-text-tertiary mt-4">
                Appuyez sur Entrée ↵
              </p>

            </motion.div>
          </AnimatePresence>

        </div>
      </div>
    </div>
  );
}