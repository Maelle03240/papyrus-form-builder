'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { Plus, Trash2 } from 'lucide-react';

import { SortableFieldCard } from '@/components/builder/FieldCard';
import { cn } from '@/lib/utils';
import type { Field, FieldStyle, FormTheme, Section } from '@/types';

/**
 * Une section dans le canevas du constructeur.
 *
 * Elle remplace le pseudo-champ `section_break`, qui était une carte comme une
 * autre au milieu de la liste : on pouvait le dupliquer, lui donner un style de
 * question, le laisser sans rien après lui. Une section est maintenant un
 * contenant — elle a un titre, elle porte ses questions, et elle se déplace d'un
 * bloc.
 *
 * Le conteneur est une zone de dépôt à part entière, ce qui permet de faire
 * glisser une question dans une section encore vide : sans cela, une section
 * sans question serait impossible à remplir autrement qu'en cliquant.
 */

export interface SectionBlockHandlers {
  onSelect: () => void;
  onChange: (patch: Partial<Field>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

interface Props {
  section: Section;
  fields: Field[];
  index: number;
  /** La dernière section ne peut pas être supprimée : un formulaire en garde une. */
  canDelete: boolean;
  selectedFieldId: string | null;
  theme: FormTheme;
  globalStyle?: FieldStyle;
  cardBg?: string;
  scoringEnabled?: boolean;
  fieldHandlers: Record<string, SectionBlockHandlers>;
  onTitleChange: (sectionId: string, title: string) => void;
  onAddQuestion: (sectionId: string) => void;
  onDelete: (sectionId: string) => void;
}

export function SectionBlock({
  section,
  fields,
  index,
  canDelete,
  selectedFieldId,
  theme,
  globalStyle,
  cardBg,
  scoringEnabled,
  fieldHandlers,
  onTitleChange,
  onAddQuestion,
  onDelete
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `section:${section.id}` });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'group/section rounded-2xl border border-transparent px-3 py-3 transition',
        isOver && 'border-dashed border-accent-cta bg-accent-cta/5'
      )}
    >
      <header className="mb-3 flex items-center gap-2">
        <input
          value={section.title.fr ?? ''}
          onChange={(event) => onTitleChange(section.id, event.target.value)}
          placeholder={`Section ${index + 1}`}
          aria-label={`Titre de la section ${index + 1}`}
          className="min-w-0 flex-1 rounded-sm border-0 bg-transparent px-1 py-0.5 font-display text-lg font-bold text-text-primary placeholder:font-normal placeholder:italic placeholder:text-text-tertiary focus:bg-bg-elevated/50 focus:outline-hidden"
        />

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover/section:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => onAddQuestion(section.id)}
            title="Ajouter une question à cette section"
            className="rounded-md p-1.5 text-text-tertiary transition hover:bg-bg-elevated hover:text-text-primary focus-visible:opacity-100"
          >
            <Plus className="h-4 w-4" />
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(section.id)}
              title="Supprimer la section et ses questions"
              className="rounded-md p-1.5 text-text-tertiary transition hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <SortableContext items={fields.map((field) => field.id)} strategy={rectSortingStrategy}>
        {fields.length === 0 ? (
          <button
            type="button"
            onClick={() => onAddQuestion(section.id)}
            className="w-full rounded-xl border border-dashed border-border-strong px-4 py-8 text-sm text-text-tertiary transition hover:border-accent-cta hover:text-text-secondary"
          >
            Section vide — ajouter une question
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {fields.map((field, position) => {
              const handlers = fieldHandlers[field.id];
              if (!handlers) return null;

              return (
                <SortableFieldCard
                  key={field.id}
                  field={field}
                  index={position}
                  selected={selectedFieldId === field.id}
                  globalStyle={globalStyle}
                  cardBg={cardBg}
                  theme={theme}
                  scoringEnabled={scoringEnabled}
                  onSelect={handlers.onSelect}
                  onChange={handlers.onChange}
                  onDuplicate={handlers.onDuplicate}
                  onDelete={handlers.onDelete}
                />
              );
            })}
          </div>
        )}
      </SortableContext>
    </section>
  );
}
