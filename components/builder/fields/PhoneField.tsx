'use client';

import type { Field } from '@/types';

interface PhoneFieldProps {
  placeholder?: string;
  field?: Field;
  onChange?: (patch: Partial<Field>) => void;
}

export function PhoneField({ placeholder, field, onChange }: PhoneFieldProps) {
  const isEditing = !!onChange && !!field;

  return (
    <div style={{ position: 'relative' }}>

      {/* CHAMP PRINCIPAL - Version statique pour le builder */}
      <div style={{
        display: 'flex',
        border: isEditing ? '1px dashed var(--papyrus-border)' : '1px solid var(--papyrus-border)',
        borderRadius: '8px',
        overflow: 'visible',
        background: 'var(--papyrus-surface)'
      }}>

        {/* BADGE PAYS — non cliquable en mode builder */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '0 12px',
            borderRight: '1px solid var(--papyrus-border)',
            background: 'transparent',
            minWidth: '90px',
            fontSize: '14px'
          }}
        >
          <img
            src="https://flagcdn.com/w20/mu.png"
            width={20}
            height={15}
            alt="Maurice"
            style={{ borderRadius: '2px', flexShrink: 0 }}
          />
          <span style={{ color: 'var(--fg-secondary)' }}>+230</span>
        </div>

        {/* INPUT NUMÉRO — éditable si on est en mode édition, sinon statique/disabled */}
        {isEditing ? (
          <input
            type="text"
            value={field.placeholder?.fr ?? ''}
            onChange={(e) => {
              const current = field.placeholder ?? {};
              onChange({ placeholder: { ...current, fr: e.target.value } });
            }}
            placeholder={placeholder || "57 12 34 56"}
            style={{
              flex: 1,
              padding: '10px 12px',
              border: 'none',
              background: 'transparent',
              fontSize: '14px',
              outline: 'none',
              color: 'var(--fg-tertiary)',
            }}
          />
        ) : (
          <input
            type="tel"
            disabled
            placeholder={placeholder || "57 12 34 56"}
            style={{
              flex: 1,
              padding: '10px 12px',
              border: 'none',
              background: 'transparent',
              fontSize: '14px',
              outline: 'none',
              color: 'var(--fg-tertiary)',
              cursor: 'default'
            }}
          />
        )}
      </div>
    </div>
  );
}