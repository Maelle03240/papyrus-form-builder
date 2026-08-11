'use client';

import type { Field, FieldStyle } from '@/types';
import { StyleControls } from './StyleControls';

interface Props {
  field: Field;
  globalStyle?: FieldStyle;
  onChange: (patch: Partial<Field>) => void;
}

export function StyleEditor({ field, globalStyle, onChange }: Props) {
  const fieldStyle = field.style ?? {};
  const hasGlobal = globalStyle && Object.keys(globalStyle).length > 0;
  const hasOverride = field.style && Object.keys(field.style).length > 0;

  function handleChange(next: FieldStyle) {
    // Si l'objet devient totalement vide, on remet undefined pour retomber sur le style global
    onChange({ style: Object.keys(next).length === 0 ? undefined : next });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="papyrus-meta text-xs uppercase tracking-wide not-italic">i. Apparence du champ</div>
        <p className="mt-1 text-xs text-text-tertiary">
          {hasGlobal
            ? 'Override le style global du formulaire pour cette question.'
            : 'Personnalisez le titre de cette question.'}
        </p>
      </div>

      {hasGlobal && !hasOverride && (
        <div className="rounded-md border border-mooove-cyan/30 bg-mooove-cyan/5 px-3 py-2 text-xs text-text-secondary">
          Cette question utilise le <strong>style global</strong> du formulaire. Modifiez ci-dessous pour la
          personnaliser indépendamment.
        </div>
      )}

      <StyleControls style={fieldStyle} onChange={handleChange} />

      {hasOverride && (
        <button
          type="button"
          onClick={() => onChange({ style: undefined })}
          className="w-full rounded-md border border-dashed border-border-strong py-2 text-xs text-text-secondary hover:border-danger hover:text-danger"
        >
          Réinitialiser (utiliser le style global)
        </button>
      )}
    </div>
  );
}
