'use client';

import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { EMPTY_FILTER, isFilterActive, type RecordsFilter } from '@/lib/records';
import { SUBMISSION_STATUSES, SUBMISSION_STATUS_LABELS } from '@/types';
import type { Form } from '@/types';

/**
 * La barre de filtres du tableau des réponses.
 *
 * Elle est partagée par la vue d'un formulaire et la vue agrégée d'un projet :
 * les deux filtrent la même chose, et un filtre qui n'existerait que d'un côté
 * se remarque au moment où l'on cherche à retrouver une inscription.
 *
 * Chaque contrôle porte une étiquette visible plutôt qu'une simple invite : une
 * barre de six listes déroulantes sans étiquettes oblige à toutes les ouvrir
 * pour savoir laquelle filtre quoi.
 */

const CONTROL =
  'h-9 rounded-md border border-border-strong bg-bg-base px-2.5 text-sm text-text-primary focus:border-accent focus:outline-hidden';

interface Props {
  filter: RecordsFilter;
  onChange: (filter: RecordsFilter) => void;
  /** Langues réellement présentes dans les réponses. */
  languages: string[];
  /** Vue projet : permet de restreindre à un formulaire. */
  forms?: Form[];
  /** Nombre d'ébauches — le bouton n'apparaît que s'il y en a. */
  partialCount: number;
}

export function RecordsFilters({
  filter,
  onChange,
  languages,
  forms,
  partialCount
}: Props) {
  const patch = (update: Partial<RecordsFilter>) => onChange({ ...filter, ...update });

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Rechercher" htmlFor="records-search" className="min-w-[15rem] flex-1">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
            aria-hidden="true"
          />
          <input
            id="records-search"
            value={filter.search}
            onChange={(event) => patch({ search: event.target.value })}
            placeholder="Numéro, adresse e-mail, ou n'importe quelle réponse"
            className={`${CONTROL} w-full pl-8`}
          />
        </div>
      </Field>

      {forms && forms.length > 1 && (
        <Field label="Formulaire" htmlFor="records-form">
          <select
            id="records-form"
            value={filter.formId}
            onChange={(event) => patch({ formId: event.target.value })}
            className={`${CONTROL} max-w-[14rem]`}
          >
            <option value="all">Tous</option>
            {forms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.title || 'Formulaire sans titre'}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Statut" htmlFor="records-status">
        <select
          id="records-status"
          value={filter.status}
          onChange={(event) =>
            patch({ status: event.target.value as RecordsFilter['status'] })
          }
          className={CONTROL}
        >
          <option value="all">Tous</option>
          {SUBMISSION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {SUBMISSION_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </Field>

      {languages.length > 1 && (
        <Field label="Langue" htmlFor="records-language">
          <select
            id="records-language"
            value={filter.language}
            onChange={(event) => patch({ language: event.target.value })}
            className={CONTROL}
          >
            <option value="all">Toutes</option>
            {languages.map((code) => (
              <option key={code} value={code}>
                {code.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Du" htmlFor="records-from">
        <input
          id="records-from"
          type="date"
          value={filter.from}
          max={filter.to || undefined}
          onChange={(event) => patch({ from: event.target.value })}
          className={CONTROL}
        />
      </Field>

      <Field label="Au" htmlFor="records-to">
        <input
          id="records-to"
          type="date"
          value={filter.to}
          min={filter.from || undefined}
          onChange={(event) => patch({ to: event.target.value })}
          className={CONTROL}
        />
      </Field>

      {partialCount > 0 && (
        <Field label="Ébauches" htmlFor="records-partials">
          <select
            id="records-partials"
            value={filter.includePartials ? '1' : '0'}
            onChange={(event) => patch({ includePartials: event.target.value === '1' })}
            className={CONTROL}
          >
            <option value="0">Masquées</option>
            <option value="1">Incluses ({partialCount})</option>
          </select>
        </Field>
      )}

      {isFilterActive(filter) && (
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<X className="h-3.5 w-3.5" />}
          onClick={() => onChange({ ...EMPTY_FILTER })}
        >
          Tout effacer
        </Button>
      )}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs text-text-tertiary">
        {label}
      </label>
      {children}
    </div>
  );
}
