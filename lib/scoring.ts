// lib/scoring.ts — Logique de calcul des scores de maturité

import type { Form, Field, FieldOption, ScoreLevel } from '@/types';
import { evaluateLogicRules } from './logic-evaluation';

/** Structure représentant les réponses d'un répondant */
export interface FormResponses {
  [fieldId: string]: string | string[] | number | { [optionId: string]: { [subfieldId: string]: string } };
}

/** Résultat du calcul de score */
export interface ScoreResult {
  /** Score total obtenu */
  totalScore: number;
  /** Score maximum possible */
  maxScore: number;
  /** Pourcentage (0-100) */
  percentage: number;
  /** Détail par champ */
  fieldScores: Array<{
    fieldId: string;
    fieldType: string;
    fieldLabel: string;
    score: number;
    maxScore: number;
  }>;
}

/**
 * Calcule le score de maturité d'un formulaire basé sur les réponses.
 * Seuls les champs avec scoring activé contribuent au score.
 *
 * Les champs masqués par la logique conditionnelle sont exclus du calcul —
 * numérateur **et** dénominateur. Sans cela, une question notée que le
 * répondant n'a jamais vue ajoutait son barème au score maximum tout en
 * rapportant zéro : deux personnes répondant aussi bien l'une que l'autre
 * obtenaient des pourcentages différents selon la branche empruntée, et celle
 * qui avait vu moins de questions était pénalisée.
 */
export function calculateFormScore(form: Form, responses: FormResponses): ScoreResult | null {
  // Si le scoring n'est pas activé, pas de calcul
  if (!form.scoring_enabled) {
    return null;
  }

  const fields = form.fields || [];
  const rules = form.logic_rules ?? [];
  // Sans règle, tous les champs comptent : on évite un parcours inutile.
  const visibleIds =
    rules.length > 0 ? evaluateLogicRules(rules, responses, fields) : null;

  const fieldScores: ScoreResult['fieldScores'] = [];
  let totalScore = 0;
  let maxScore = 0;

  for (const field of fields) {
    if (visibleIds && !visibleIds.has(field.id)) continue;

    const fieldScore = calculateFieldScore(field, responses[field.id]);
    if (fieldScore) {
      fieldScores.push({
        fieldId: field.id,
        fieldType: field.type,
        fieldLabel: field.label.fr || `Champ ${field.field_order}`,
        score: fieldScore.score,
        maxScore: fieldScore.maxScore,
      });
      totalScore += fieldScore.score;
      maxScore += fieldScore.maxScore;
    }
  }

  return {
    totalScore,
    maxScore,
    percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
    fieldScores,
  };
}

/**
 * Calcule le score d'un champ individual.
 */
function calculateFieldScore(field: Field, response: any): { score: number; maxScore: number } | null {
  const options = field.options || [];
  const hasValidPoints = options.some(opt => typeof opt.points === 'number');

  // Si aucune option n'a de points définis, ce champ ne contribue pas au score
  if (!hasValidPoints) {
    return null;
  }

  switch (field.type) {
    case 'single_choice':
    case 'dropdown':
      return calculateSingleChoiceScore(options, response);

    case 'multiple_choice':
      return calculateMultipleChoiceScore(options, response);

    case 'matrix':
      return calculateMatrixScore(field, response);

    case 'rating':
      return calculateRatingScore(field, response);

    case 'nps':
      return calculateNpsScore(field, response);

    default:
      return null;
  }
}

/**
 * Score pour single_choice et dropdown : points de l'option sélectionnée.
 */
function calculateSingleChoiceScore(options: FieldOption[], response: string): { score: number; maxScore: number } {
  const selectedOption = options.find(opt => opt.id === response);
  const score = selectedOption?.points || 0;
  const points = options.map(opt => opt.points || 0);
  const maxScore = points.length > 0 ? Math.max(...points) : 0;

  return { score, maxScore };
}

/**
 * Score pour multiple_choice : somme des points des options sélectionnées.
 */
function calculateMultipleChoiceScore(options: FieldOption[], response: string[]): { score: number; maxScore: number } {
  if (!Array.isArray(response)) {
    return { score: 0, maxScore: 0 };
  }

  let score = 0;
  for (const optionId of response) {
    const option = options.find(opt => opt.id === optionId);
    if (option?.points) {
      score += option.points;
    }
  }

  // Pour multiple choice, le max est la somme de tous les points possibles
  const maxScore = options.reduce((sum, opt) => sum + (opt.points || 0), 0);

  return { score, maxScore };
}

/**
 * Score pour matrice : somme des points des colonnes sélectionnées.
 */
function calculateMatrixScore(field: Field, response: any): { score: number; maxScore: number } {
  const columns = field.options || []; // Les colonnes de la matrice
  const rows = field.rows || [];
  const mode = field.validation?.matrix_mode || 'single';

  if (!response || typeof response !== 'object') {
    return { score: 0, maxScore: 0 };
  }

  let score = 0;
  const columnPoints = columns.map(col => col.points || 0);
  const maxScorePerRow = columnPoints.length > 0 ? Math.max(...columnPoints) : 0;
  const maxScore = rows.length * maxScorePerRow;

  // response format: { [rowId]: string | string[] }
  for (const [_rowId, rowResponse] of Object.entries(response)) {
    if (mode === 'single') {
      // Une seule réponse par ligne
      const selectedColumn = columns.find(col => col.id === rowResponse);
      if (selectedColumn?.points) {
        score += selectedColumn.points;
      }
    } else {
      // Plusieurs réponses par ligne (mode 'multiple')
      if (Array.isArray(rowResponse)) {
        for (const columnId of rowResponse) {
          const column = columns.find(col => col.id === columnId);
          if (column?.points) {
            score += column.points;
          }
        }
      }
    }
  }

  return { score, maxScore: mode === 'single' ? maxScore : maxScore * columns.length };
}

/**
 * Score pour rating : mapping 1-max étoiles vers points.
 * Par défaut : 1 étoile = 1 point, max étoiles = max points.
 */
function calculateRatingScore(field: Field, response: number): { score: number; maxScore: number } {
  const maxScore = field.validation?.max ?? 5;

  if (typeof response !== 'number') {
    return { score: 0, maxScore };
  }

  // Clamp entre 1 et maxScore
  const rating = Math.max(1, Math.min(maxScore, response));
  return { score: rating, maxScore };
}

/**
 * Score pour NPS : mapping min-max vers points.
 */
function calculateNpsScore(field: Field, response: number): { score: number; maxScore: number } {
  const min = field.validation?.min ?? 0;
  const max = field.validation?.max ?? 10;

  if (typeof response !== 'number') {
    return { score: 0, maxScore: max };
  }

  // Clamp entre min et max
  const nps = Math.max(min, Math.min(max, response));
  return { score: nps, maxScore: max };
}

export const DEFAULT_SCORE_LEVELS: ScoreLevel[] = [
  {
    minPercent: 80,
    title: 'Excellent !',
    description: 'Vous démontrez une très bonne maturité dans ce domaine.',
    color: 'green'
  },
  {
    minPercent: 60,
    title: 'Bien !',
    description: 'Vous avez une bonne base, avec quelques axes d\'amélioration.',
    color: 'blue'
  },
  {
    minPercent: 40,
    title: 'En progression',
    description: 'Vous êtes sur la bonne voie, continuez vos efforts.',
    color: 'orange'
  },
  {
    minPercent: 0,
    title: 'À développer',
    description: 'Il y a de belles opportunités d\'amélioration à explorer.',
    color: 'red'
  }
];

const COLOR_CLASSES: Record<string, string> = {
  green: 'text-green-600',
  blue: 'text-blue-600',
  orange: 'text-orange-600',
  red: 'text-red-600'
};

/**
 * Génère un message contextuel basé sur le pourcentage de score.
 */
export function getScoreMessage(
  percentage: number,
  levels?: ScoreLevel[]
): { title: string; description: string; color: string } {
  const activeLevels = (levels && levels.length > 0) ? levels : DEFAULT_SCORE_LEVELS;
  const sorted = [...activeLevels].sort((a, b) => b.minPercent - a.minPercent);

  // Trouver le premier niveau dont le pourcentage est inférieur ou égal
  const matched = sorted.find(level => percentage >= level.minPercent) || sorted[sorted.length - 1];

  return {
    title: matched.title,
    description: matched.description,
    color: COLOR_CLASSES[matched.color] || 'text-text-secondary'
  };
}