// lib/hooks/useFormScore.ts — Hook pour gérer le score en temps réel

import { useState, useCallback, useMemo } from 'react';
import type { Form } from '@/types';
import { calculateFormScore, type FormResponses } from '@/lib/scoring';

/**
 * Hook pour gérer le score d'un formulaire en temps réel.
 * Calcule automatiquement le score à chaque mise à jour des réponses.
 */
export function useFormScore(form: Form) {
  const [responses, setResponses] = useState<FormResponses>({});

  // Calcul du score basé sur les réponses actuelles
  const scoreResult = useMemo(() => {
    return calculateFormScore(form, responses);
  }, [form, responses]);

  // Met à jour la réponse d'un champ spécifique
  const updateResponse = useCallback((fieldId: string, response: any) => {
    setResponses(prev => ({
      ...prev,
      [fieldId]: response
    }));
  }, []);

  // Supprime la réponse d'un champ
  const clearResponse = useCallback((fieldId: string) => {
    setResponses(prev => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }, []);

  // Remet à zéro toutes les réponses
  const resetResponses = useCallback(() => {
    setResponses({});
  }, []);

  // Helpers pour vérifier l'état
  const hasResponses = Object.keys(responses).length > 0;
  const isComplete = useMemo(() => {
    const requiredFields = (form.fields || []).filter(f => f.required);
    return requiredFields.every(field => responses[field.id] != null);
  }, [form.fields, responses]);

  return {
    // État
    responses,
    scoreResult,
    hasResponses,
    isComplete,

    // Actions
    updateResponse,
    clearResponse,
    resetResponses,

    // Helpers
    scoringEnabled: form.scoring_enabled || false,
    showScoreToRespondent: form.show_score_to_respondent || false,
  };
}