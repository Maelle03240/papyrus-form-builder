'use client';

import { CheckCircle, TrendingUp } from 'lucide-react';
import type { ScoreResult } from '@/lib/scoring';
import { getScoreMessage } from '@/lib/scoring';
import { cn } from '@/lib/utils';
import type { ScoreLevel } from '@/types';

interface Props {
  scoreResult: ScoreResult;
  className?: string;
  scoreLabel?: string;
  scoreDescription?: string;
  scoreLevels?: ScoreLevel[];
}

/**
 * Affiche le résultat final du score de maturité au répondant.
 * Utilisé uniquement si le créateur a activé l'affichage du score.
 */
export function ScoreDisplay({ scoreResult, className, scoreLabel, scoreDescription, scoreLevels }: Props) {
  const { title, description, color } = getScoreMessage(scoreResult.percentage, scoreLevels);

  return (
    <div className={cn('rounded-2xl border border-border bg-bg-surface p-6', className)}>
      <div className="flex items-start gap-4">
        <div className="rounded-full bg-accent/10 p-2">
          <TrendingUp className="h-5 w-5 text-accent" />
        </div>

        <div className="flex-1">
          <div className="mb-3">
            <h3 className="mb-1 font-display text-xl font-medium text-text-primary">
              {scoreLabel ?? 'Votre score de maturité'}
            </h3>
            <p className="text-sm text-text-secondary">
              {scoreDescription ?? 'Basé sur vos réponses à ce formulaire'}
            </p>
          </div>

          {/* Score principal */}
          <div className="mb-4">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-text-primary">
                {scoreResult.percentage}%
              </span>
              <span className="text-sm text-text-secondary">
                ({scoreResult.totalScore} / {scoreResult.maxScore} points)
              </span>
            </div>

            {/* Barre de progression */}
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-full bg-accent transition-all duration-500 ease-out"
                style={{ width: `${scoreResult.percentage}%` }}
              />
            </div>
          </div>

          {/* Message contextuel */}
          <div className="mb-4 rounded-lg border border-border bg-bg-base p-3">
            <h4 className={cn('mb-1 text-sm font-medium', color)}>
              {title}
            </h4>
            <p className="text-xs text-text-secondary">
              {description}
            </p>
          </div>

          {/* Détail par champ (optionnel) */}
          {scoreResult.fieldScores.length > 1 && (
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-text-secondary hover:text-text-primary">
                Voir le détail par section
              </summary>

              <div className="mt-2 space-y-1.5">
                {scoreResult.fieldScores.map((fieldScore) => (
                  <div
                    key={fieldScore.fieldId}
                    className="flex items-center justify-between rounded-sm border border-border-weak bg-bg-base px-2 py-1.5"
                  >
                    <span className="text-xs text-text-secondary">
                      {fieldScore.fieldLabel}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-mono text-text-primary">
                        {fieldScore.score}/{fieldScore.maxScore}
                      </span>
                      {fieldScore.score === fieldScore.maxScore && (
                        <CheckCircle className="h-3 w-3 text-green-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}