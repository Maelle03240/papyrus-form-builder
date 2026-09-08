'use client';

import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SUBMISSION_STATUSES, SUBMISSION_STATUS_LABELS, type SubmissionStatus } from '@/types';

/**
 * Le statut d'une réponse — à la fois lu et changé au même endroit.
 *
 * Une pastille de couleur pour lire d'un coup d'œil, et une liste native pour
 * changer. Une liste plutôt qu'un menu dessiné : elle se parcourt au clavier, et
 * sur un tableau de deux cents lignes un menu qui s'ouvre au-delà du bord de la
 * page est inutilisable — c'est précisément là qu'on change des statuts en série.
 *
 * Le `<select>` est transparent et couvre toute la pastille : l'apparence vient
 * du dessous, le comportement du navigateur.
 */

const TONES: Record<SubmissionStatus, string> = {
  submitted: 'bg-bg-elevated text-text-secondary border-border',
  reviewed: 'bg-mooove-cyan/12 text-mooove-navy border-mooove-cyan/40',
  paid: 'bg-success/12 text-success border-success/40',
  // Annulée : le seul état qui retire la réponse des comptes, donc le seul
  // écrit en gris barré — il doit se distinguer de « reçue », qui lui ressemble.
  void: 'bg-transparent text-text-tertiary border-border line-through'
};

interface Props {
  value: SubmissionStatus;
  onChange: (status: SubmissionStatus) => void;
  disabled?: boolean;
  /** Étiquette accessible — le tableau en compte autant que de lignes. */
  label: string;
}

export function StatusSelect({ value, onChange, disabled, label }: Props) {
  return (
    <span
      className={cn(
        'relative inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition',
        TONES[value],
        disabled ? 'opacity-60' : 'cursor-pointer'
      )}
    >
      {SUBMISSION_STATUS_LABELS[value]}
      <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as SubmissionStatus)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {SUBMISSION_STATUSES.map((status) => (
          <option key={status} value={status}>
            {SUBMISSION_STATUS_LABELS[status]}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Version non modifiable — pour une ébauche, qui n'a pas encore de statut. */
export function StatusPill({ value }: { value: SubmissionStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONES[value]
      )}
    >
      {SUBMISSION_STATUS_LABELS[value]}
    </span>
  );
}
