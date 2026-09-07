'use client';

import { Plus, Trash2 } from 'lucide-react';

import {
  conditionSourceFields,
  conditionValueChoices,
  getOperatorsForFieldType,
  isChoiceField,
  operatorNeedsValue
} from '@/lib/condition-operators';
import { cn } from '@/lib/utils';
import type { ConditionOperator, Field, LogicCondition, VisibilityRule } from '@/types';

/**
 * Éditeur du verrou de visibilité d'un champ ou d'une section.
 *
 * Il s'écrit depuis l'élément cible — « ne m'affiche que si… » — alors que
 * `LogicEditor` s'écrit depuis la question source. C'est le point de vue le seul
 * praticable quand une même question dépend de trois autres : autrement il
 * faudrait ouvrir trois panneaux différents pour comprendre pourquoi elle
 * apparaît.
 *
 * Aucune condition : le verrou est ouvert, l'élément s'affiche toujours.
 */

interface Props {
  /** Toutes les questions du formulaire — les sources possibles. */
  fields: Field[];
  /** Exclu des sources : une question ne peut pas dépendre d'elle-même. */
  excludeFieldId?: string;
  value: VisibilityRule | undefined;
  onChange: (rule: VisibilityRule | undefined) => void;
  /** Ce que l'élément est, à la première personne — « Cette question ». */
  subject: string;
}

export function ConditionsEditor({
  fields,
  excludeFieldId,
  value,
  onChange,
  subject
}: Props) {
  const sources = conditionSourceFields(fields, excludeFieldId);
  const conditions = value?.conditions ?? [];
  const operator = value?.operator ?? 'AND';

  const emit = (next: LogicCondition[], nextOperator = operator) => {
    // Un verrou sans condition est un verrou absent : on efface la structure
    // plutôt que d'enregistrer une liste vide, qui aurait le même effet mais
    // laisserait croire à une configuration.
    onChange(next.length === 0 ? undefined : { conditions: next, operator: nextOperator });
  };

  const addCondition = () => {
    const source = sources[0];
    if (!source) return;
    const operators = getOperatorsForFieldType(source.type);
    emit([
      ...conditions,
      {
        source_field_id: source.id,
        operator: operators[0]?.value ?? 'equals',
        value: conditionValueChoices(source)[0]?.value ?? ''
      }
    ]);
  };

  const patchCondition = (index: number, patch: Partial<LogicCondition>) => {
    emit(
      conditions.map((condition, position) => {
        if (position !== index) return condition;
        const next = { ...condition, ...patch };

        // Changer de question source rend l'opérateur et la valeur précédents
        // caducs : « contient » n'existe pas sur une note, et l'identifiant
        // d'option retenu appartenait à une autre question.
        if (patch.source_field_id) {
          const source = fields.find((field) => field.id === patch.source_field_id);
          const operators = getOperatorsForFieldType(source?.type ?? '');
          next.operator = operators[0]?.value ?? 'equals';
          next.value = source ? conditionValueChoices(source)[0]?.value ?? '' : '';
        }

        return next;
      })
    );
  };

  if (sources.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border-strong bg-bg-base px-3 py-2.5 text-xs text-text-tertiary">
        Ajoutez d&apos;abord une autre question : un affichage conditionnel a besoin
        de quelque chose à observer.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-text-tertiary">
        {conditions.length === 0
          ? `${subject} s'affiche toujours.`
          : `${subject} ne s'affiche que si ${
              conditions.length > 1
                ? operator === 'AND'
                  ? 'toutes les conditions sont vraies'
                  : "au moins une condition est vraie"
                : 'la condition est vraie'
            }.`}
      </p>

      {conditions.length >= 2 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase text-text-tertiary">
            Combiner avec :
          </span>
          <div className="inline-flex rounded-md border border-border bg-bg-surface p-0.5">
            {(['AND', 'OR'] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => emit(conditions, candidate)}
                className={cn(
                  'rounded-sm px-2 py-0.5 text-[10px] font-bold transition',
                  operator === candidate
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary'
                )}
              >
                {candidate === 'AND' ? 'ET' : 'OU'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {conditions.map((condition, index) => {
          const source = fields.find((field) => field.id === condition.source_field_id);
          const operators = getOperatorsForFieldType(source?.type ?? '');
          const choices = source ? conditionValueChoices(source) : [];
          const needsValue = operatorNeedsValue(condition.operator);

          return (
            <div
              key={index}
              className="relative space-y-1.5 rounded-lg border border-border/80 bg-bg-surface p-2"
            >
              <Row label="Si">
                <select
                  value={condition.source_field_id}
                  onChange={(event) =>
                    patchCondition(index, { source_field_id: event.target.value })
                  }
                  className={SELECT_CLASS}
                >
                  {sources.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label?.fr || 'Question sans titre'}
                    </option>
                  ))}
                </select>
              </Row>

              <Row label="Qui">
                <select
                  value={condition.operator}
                  onChange={(event) =>
                    patchCondition(index, {
                      operator: event.target.value as ConditionOperator
                    })
                  }
                  className={SELECT_CLASS}
                >
                  {operators.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </Row>

              {needsValue && (
                <Row label="Valeur">
                  {isChoiceField(source) && choices.length > 0 ? (
                    <select
                      value={condition.value}
                      onChange={(event) => patchCondition(index, { value: event.target.value })}
                      className={SELECT_CLASS}
                    >
                      {choices.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={condition.value}
                      onChange={(event) => patchCondition(index, { value: event.target.value })}
                      placeholder="Valeur attendue"
                      className={SELECT_CLASS}
                    />
                  )}
                </Row>
              )}

              <button
                type="button"
                onClick={() => emit(conditions.filter((_, position) => position !== index))}
                aria-label={`Supprimer la condition ${index + 1}`}
                className="absolute right-1.5 top-1.5 rounded-sm p-1 text-text-tertiary transition hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addCondition}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 py-2 text-xs text-text-secondary transition hover:border-accent hover:text-text-primary"
      >
        <Plus className="h-3.5 w-3.5" />
        Ajouter une condition
      </button>
    </div>
  );
}

const SELECT_CLASS =
  'h-7 w-full rounded-md border border-border bg-bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-hidden';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[52px_1fr] items-center gap-2 pr-6">
      <span className="text-[10px] font-medium uppercase text-text-tertiary">{label}</span>
      {children}
    </div>
  );
}
