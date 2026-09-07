'use client';

import { Plus, Trash2, Award, X } from 'lucide-react';
import type { Field, Form, LogicCondition, LogicAction, LogicRule, DisplayMode } from '@/types';
import { FIELD_META } from '@/lib/field-meta';
import { getFieldsInSameSection, getSections } from '@/lib/sections';
import { cn } from '@/lib/utils';

interface Props {
  form: Form;
  field: Field;
  onFormChange: (patch: Partial<Form>) => void;
}

const ALL_ACTIONS: { value: LogicAction; label: string; modes: DisplayMode[] }[] = [
  { value: 'show_field', label: 'Afficher', modes: ['scroll', 'sections'] },
  { value: 'hide_field', label: 'Masquer', modes: ['scroll', 'sections'] },
  { value: 'jump_to', label: 'Aller à', modes: ['scroll', 'sections', 'typeform'] },
  { value: 'end_form', label: 'Terminer le formulaire', modes: ['scroll', 'sections', 'typeform'] }
];

function getOperatorsForFieldType(type: string) {
  if (['short_text', 'long_text', 'email', 'url', 'phone'].includes(type)) {
    return [
      { value: 'equals', label: 'est égal à' },
      { value: 'not_equals', label: 'est différent de' },
      { value: 'contains', label: 'contient' },
      { value: 'not_contains', label: 'ne contient pas' }
    ];
  }
  if (['number', 'rating', 'nps'].includes(type)) {
    return [
      { value: 'equals', label: 'est égal à' },
      { value: 'not_equals', label: 'est différent de' },
      { value: 'greater_than', label: 'est supérieur à' },
      { value: 'less_than', label: 'est inférieur à' }
    ];
  }
  return [
    { value: 'equals', label: 'est égal à' },
    { value: 'not_equals', label: 'est différent de' }
  ];
}

function isChoiceField(field?: Field) {
  return field ? ['single_choice', 'multiple_choice', 'dropdown'].includes(field.type) : false;
}

/**
 * Calcule le score de maturité d'un champ (points min/max disponibles).
 */
function getFieldScoreInfo(field: Field): { minPoints: number; maxPoints: number; hasScoring: boolean } {
  const options = field.options || [];
  const points = options.map(opt => opt.points || 0).filter(p => p > 0);

  if (points.length === 0) {
    return { minPoints: 0, maxPoints: 0, hasScoring: false };
  }

  switch (field.type) {
    case 'single_choice':
    case 'dropdown':
      return {
        minPoints: Math.min(...points),
        maxPoints: Math.max(...points),
        hasScoring: true
      };

    case 'multiple_choice':
      return {
        minPoints: Math.min(...points),
        maxPoints: points.reduce((sum, p) => sum + p, 0), // Somme de tous les points
        hasScoring: true
      };

    case 'matrix':
      const rows = field.rows || [];
      const maxPerRow = points.length > 0 ? Math.max(...points) : 0;
      return {
        minPoints: points.length > 0 ? Math.min(...points) : 0,
        maxPoints: maxPerRow * rows.length,
        hasScoring: true
      };

    case 'rating':
      return { minPoints: 1, maxPoints: 5, hasScoring: true };

    case 'nps':
      return {
        minPoints: field.validation?.min ?? 0,
        maxPoints: field.validation?.max ?? 10,
        hasScoring: true
      };

    default:
      return { minPoints: 0, maxPoints: 0, hasScoring: false };
  }
}

export function LogicEditor({ form, field, onFormChange }: Props) {
  const mode: DisplayMode = form.display_mode ?? 'scroll';
  const allFields = form.fields ?? [];
  const rules = (form.logic_rules ?? []).filter((r) =>
    r.conditions?.some((c) => c.source_field_id === field.id)
  );
  const scoreInfo = getFieldScoreInfo(field);
  const scoringEnabled = form?.scoring_enabled ?? false;

  // Actions disponibles selon le mode
  const availableActions = ALL_ACTIONS.filter((a) => a.modes.includes(mode));

  /** Cibles disponibles selon l'action choisie et le mode. */
  function getTargetsForAction(action: LogicAction): Field[] {
    if (action === 'end_form') return [];

    if (action === 'jump_to') {
      if (mode === 'typeform') {
        // Toutes les questions sauf section_break
        return allFields.filter((f) => f.id !== field.id && f.type !== 'section_break');
      }
      // scroll / sections : uniquement les sections
      return getSections(allFields);
    }

    // show_field / hide_field
    if (mode === 'sections') {
      // Uniquement les champs de la même section
      return getFieldsInSameSection(allFields, field.id).filter(
        (f) => f.type !== 'section_break'
      );
    }
    // scroll : tous les autres champs
    return allFields.filter(
      (f) => f.id !== field.id && f.type !== 'section_break' && f.type !== 'image' && f.type !== 'video'
    );
  }

  function handleAdd() {
    const defaultAction = availableActions[0]?.value ?? 'end_form';
    const initialTargets = getTargetsForAction(defaultAction);
    
    const newRule: LogicRule = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      form_id: form.id,
      conditions: [{
        source_field_id: field.id,
        operator: 'equals',
        value: (field.options || [])[0]?.id ?? ''
      }],
      conditions_operator: 'AND',
      action_type: defaultAction,
      target_field_id: initialTargets[0]?.id,
      rule_order: rules.length
    };

    const updatedRules = [...(form.logic_rules ?? []), newRule];
    onFormChange({ logic_rules: updatedRules });
  }

  // Texte d'aide selon le mode
  const modeHint =
    mode === 'typeform'
      ? 'Mode Typeform : seules les actions « Aller à » et « Terminer » sont disponibles.'
      : mode === 'sections'
        ? 'Mode Pages : Afficher/Masquer s\'applique aux champs de la même section. « Aller à » cible une autre section.'
        : 'Mode Défilement : toutes les actions disponibles.';

  return (
    <div className="space-y-4">
      <div>
        <div className="papyrus-meta text-xs uppercase tracking-wide not-italic">i. Logique conditionnelle</div>
        <p className="mt-1 text-xs text-text-tertiary">{modeHint}</p>
      </div>

      {/* Score de maturité de la question */}
      {scoringEnabled && scoreInfo.hasScoring && (
        <div className="rounded-md border border-mooove-electric/30 bg-mooove-electric/5 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Award className="h-3.5 w-3.5 text-mooove-electric" />
            <span className="text-xs font-medium text-mooove-electric uppercase tracking-wide">
              Score de maturité
            </span>
          </div>
          <p className="text-xs text-text-secondary">
            Cette question rapporte entre <strong>{scoreInfo.minPoints}</strong> et{' '}
            <strong>{scoreInfo.maxPoints} points</strong> selon la réponse.
          </p>
          {field.type === 'multiple_choice' && (
            <p className="mt-1 text-[10px] text-text-tertiary">
              Mode multiple : les points se cumulent si plusieurs options sont sélectionnées.
             </p>
          )}
        </div>
      )}

      {rules.length === 0 && (
        <div className="rounded-md border border-dashed border-border-strong bg-bg-base p-4 text-center">
          <p className="text-xs text-text-tertiary">Aucune règle pour l&apos;instant</p>
        </div>
      )}

      <div className="space-y-3">
        {rules.map((rule, i) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            index={i}
            form={form}
            availableActions={availableActions}
            getTargetsForAction={getTargetsForAction}
            onChange={(patch) => {
              const updatedRules = (form.logic_rules ?? []).map((r) =>
                r.id === rule.id ? { ...r, ...patch } : r
              );
              onFormChange({ logic_rules: updatedRules });
            }}
            onDelete={() => {
              const updatedRules = (form.logic_rules ?? []).filter((r) => r.id !== rule.id);
              onFormChange({ logic_rules: updatedRules });
            }}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={handleAdd}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 py-2 text-xs text-text-secondary transition hover:border-accent hover:text-text-primary"
      >
        <Plus className="h-3.5 w-3.5" />
        Ajouter une règle
      </button>
    </div>
  );
}

interface RuleCardProps {
  rule: LogicRule;
  index: number;
  form: Form;
  availableActions: { value: LogicAction; label: string }[];
  getTargetsForAction: (action: LogicAction) => Field[];
  onChange: (patch: Partial<LogicRule>) => void;
  onDelete: () => void;
}

function RuleCard({
  rule,
  index,
  form,
  availableActions,
  getTargetsForAction,
  onChange,
  onDelete
}: RuleCardProps) {
  const showTarget = rule.action_type !== 'end_form';
  const targets = getTargetsForAction(rule.action_type);
  const allFields = form.fields ?? [];
  const sourceFields = allFields.filter(f => !['section_break', 'image', 'video', 'statement'].includes(f.type));

  const handleAddCondition = () => {
    const defaultField = sourceFields[0] || allFields[0];
    if (!defaultField) return;
    const newCond: LogicCondition = {
      source_field_id: defaultField.id,
      operator: 'equals',
      value: (defaultField.options || [])[0]?.id ?? ''
    };
    onChange({ conditions: [...rule.conditions, newCond] });
  };

  const handleRemoveCondition = (condIdx: number) => {
    const nextConditions = rule.conditions.filter((_, idx) => idx !== condIdx);
    onChange({ conditions: nextConditions });
  };

  const handleConditionChange = (condIdx: number, patch: Partial<LogicCondition>) => {
    const nextConditions = rule.conditions.map((c, idx) => {
      if (idx === condIdx) {
        const next = { ...c, ...patch };
        // Si le champ source change, réinitialiser l'opérateur et la valeur vers les valeurs par défaut du nouveau champ
        if (patch.source_field_id) {
          const newField = allFields.find(f => f.id === patch.source_field_id);
          const ops = getOperatorsForFieldType(newField?.type || '');
          next.operator = (ops[0]?.value || 'equals') as any;
          next.value = (newField?.options || [])[0]?.id ?? '';
        }
        return next;
      }
      return c;
    });
    onChange({ conditions: nextConditions });
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-bg-base p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary">Règle {index + 1}</span>
        <button
          type="button"
          onClick={onDelete}
          className="text-text-tertiary transition hover:text-danger"
          aria-label="Supprimer la règle"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ET/OU Toggle */}
      {rule.conditions.length >= 2 && (
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] text-text-tertiary uppercase font-medium">Combiner avec :</span>
          <div className="inline-flex rounded-md border border-border p-0.5 bg-bg-surface">
            <button
              type="button"
              onClick={() => onChange({ conditions_operator: 'AND' })}
              className={cn(
                "px-2 py-0.5 text-[10px] font-bold rounded-sm transition",
                rule.conditions_operator === 'AND' ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
              )}
            >
              ET
            </button>
            <button
              type="button"
              onClick={() => onChange({ conditions_operator: 'OR' })}
              className={cn(
                "px-2 py-0.5 text-[10px] font-bold rounded-sm transition",
                rule.conditions_operator === 'OR' ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
              )}
            >
              OU
            </button>
          </div>
        </div>
      )}

      {/* Liste des Conditions */}
      <div className="space-y-2">
        {rule.conditions.map((cond, condIdx) => {
          const condField = allFields.find(f => f.id === cond.source_field_id);
          const hasMultiple = rule.conditions.length > 1;

          return (
            <div
              key={condIdx}
              className="flex items-start gap-1 bg-bg-surface border border-border/80 rounded-lg p-2 relative group"
            >
              <div className="flex-1 space-y-1.5 min-w-0">
                {/* Champ source */}
                <div className="grid grid-cols-[65px_1fr] items-center gap-2">
                  <span className="text-[10px] text-text-tertiary uppercase font-medium">Si</span>
                  <select
                    value={cond.source_field_id}
                    onChange={(e) => handleConditionChange(condIdx, { source_field_id: e.target.value })}
                    className="h-7 w-full rounded-md border border-border bg-bg-surface px-2 text-xs focus:border-accent focus:outline-hidden"
                  >
                    {sourceFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label.fr || 'Champ sans titre'}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Opérateur */}
                <div className="grid grid-cols-[65px_1fr] items-center gap-2">
                  <span className="text-[10px] text-text-tertiary uppercase font-medium">Condition</span>
                  <select
                    value={cond.operator}
                    onChange={(e) => handleConditionChange(condIdx, { operator: e.target.value as any })}
                    className="h-7 w-full rounded-md border border-border bg-bg-surface px-2 text-xs focus:border-accent focus:outline-hidden"
                  >
                    {getOperatorsForFieldType(condField?.type || '').map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Valeur */}
                <div className="grid grid-cols-[65px_1fr] items-center gap-2">
                  <span className="text-[10px] text-text-tertiary uppercase font-medium">Valeur</span>
                  {isChoiceField(condField) ? (
                    <select
                      value={cond.value}
                      onChange={(e) => handleConditionChange(condIdx, { value: e.target.value })}
                      className="h-7 w-full rounded-md border border-border bg-bg-surface px-2 text-xs focus:border-accent focus:outline-hidden"
                    >
                      {(condField?.options || []).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label.fr || 'Option sans titre'}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={cond.value}
                      onChange={(e) => handleConditionChange(condIdx, { value: e.target.value })}
                      placeholder="Valeur"
                      className="h-7 w-full rounded-md border border-border bg-bg-surface px-2 text-xs focus:border-accent focus:outline-hidden"
                    />
                  )}
                </div>
              </div>

              {hasMultiple && (
                <button
                  type="button"
                  onClick={() => handleRemoveCondition(condIdx)}
                  className="p-1 text-text-tertiary hover:text-danger rounded-sm transition hover:bg-bg-elevated"
                  title="Supprimer cette condition"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleAddCondition}
        className="text-[11px] text-accent hover:underline font-medium flex items-center gap-1"
      >
        <Plus className="h-3 w-3" />
        Ajouter une condition
      </button>

      <div className="border-t border-border/60 my-2 pt-2 space-y-2 text-xs">
        {/* Action Type */}
        <div className="grid grid-cols-[65px_1fr] items-center gap-2">
          <span className="text-[10px] text-text-tertiary uppercase font-semibold">Alors</span>
          <select
            value={rule.action_type}
            onChange={(e) => {
              const newAction = e.target.value as LogicAction;
              const newTargets = getTargetsForAction(newAction);
              onChange({
                action_type: newAction,
                target_field_id: newAction === 'end_form' ? undefined : newTargets[0]?.id
              });
            }}
            className="h-7 w-full rounded-md border border-border bg-bg-surface px-2 text-xs focus:border-accent focus:outline-hidden"
          >
            {availableActions.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {/* Cible */}
        {showTarget && (
          <div className="grid grid-cols-[65px_1fr] items-center gap-2">
            <span className="text-[10px] text-text-tertiary uppercase font-semibold">Cible</span>
            {targets.length === 0 ? (
              <span className="text-xs italic text-text-tertiary">
                Aucune cible disponible
              </span>
            ) : (
              <select
                value={rule.target_field_id ?? ''}
                onChange={(e) => onChange({ target_field_id: e.target.value })}
                className="h-7 w-full rounded-md border border-border bg-bg-surface px-2 text-xs focus:border-accent focus:outline-hidden"
              >
                <option value="">Choisir</option>
                {targets.map((f) => {
                  const meta = FIELD_META[f.type];
                  return (
                    <option key={f.id} value={f.id}>
                      {f.label.fr || `${meta.label} sans titre`}
                    </option>
                  );
                })}
              </select>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

