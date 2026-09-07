'use client';

import { EyeOff, Trash2 } from 'lucide-react';

import { ConditionsEditor } from '@/components/builder/ConditionsEditor';
import { AutoTextarea } from '@/components/ui/AutoTextarea';
import { Switch } from '@/components/ui/Switch';
import { LIMITS } from '@/lib/constants/limits';
import type { Form, Section } from '@/types';

/**
 * Panneau de réglages d'une section.
 *
 * Une section n'était qu'un titre jusqu'à la phase 1b, et il se modifiait
 * directement dans le canevas. Depuis qu'elle porte un verrou de visibilité, il
 * lui faut un panneau : un jeu de conditions ne tient pas dans un champ de
 * titre.
 *
 * Le verrou d'une section emporte toutes ses questions — aucune n'est affichée,
 * aucune n'est exigée à l'envoi, et les réponses déjà saisies sont écartées.
 */

interface Props {
  form: Form;
  section: Section;
  /** La dernière section d'un formulaire ne se supprime pas. */
  canDelete: boolean;
  onChange: (patch: Partial<Section>) => void;
  onDelete: () => void;
}

export function SectionSettings({ form, section, canDelete, onChange, onDelete }: Props) {
  const index = [...(form.sections ?? [])]
    .sort((a, b) => a.section_order - b.section_order)
    .findIndex((candidate) => candidate.id === section.id);

  const fieldCount = (form.fields ?? []).filter(
    (field) => field.section_id === section.id
  ).length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border pb-3">
        <div className="papyrus-meta text-xs uppercase tracking-wide not-italic">
          i. Section {index + 1}
        </div>
        <p className="mt-1 text-xs text-text-tertiary">
          {fieldCount === 0
            ? 'Aucune question'
            : `${fieldCount} question${fieldCount > 1 ? 's' : ''}`}
        </p>
      </div>

      <div className="flex-1 space-y-6 pt-5">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Contenu
          </h3>

          <div className="space-y-1.5">
            <label className="block text-xs text-text-secondary">Titre</label>
            <input
              value={section.title?.fr ?? ''}
              onChange={(event) =>
                onChange({ title: { ...section.title, fr: event.target.value } })
              }
              maxLength={LIMITS.FIELD_LABEL_MAX}
              placeholder={`Section ${index + 1}`}
              className="w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs text-text-secondary">Description</label>
            <AutoTextarea
              value={section.description?.fr ?? ''}
              onChange={(event) =>
                onChange({ description: { ...section.description, fr: event.target.value } })
              }
              minRows={2}
              maxLength={LIMITS.FIELD_DESCRIPTION_MAX}
              placeholder="Ce qui aide à comprendre cette étape (optionnel)"
              className="w-full resize-none rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden"
            />
          </div>
        </div>

        <div className="space-y-3 border-t border-border pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Affichage conditionnel
          </h3>
          <ConditionsEditor
            fields={(form.fields ?? []).filter((field) => field.section_id !== section.id)}
            value={section.visibility}
            onChange={(visibility) => onChange({ visibility })}
            subject="Cette section"
          />
          <p className="text-xs leading-relaxed text-text-tertiary">
            Seules les questions des <em>autres</em> sections sont proposées : une section
            ne peut pas dépendre d&apos;une réponse qu&apos;elle est elle-même en train de
            masquer.
          </p>
        </div>

        <div className="space-y-3 border-t border-border pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Retirer du formulaire
          </h3>

          <div className="flex items-start gap-2">
            <Switch
              checked={section.hidden ?? false}
              onChange={(hidden) => onChange({ hidden })}
            />
            <div className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                <EyeOff className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                Masquer cette section
              </span>
              <p className="mt-1 text-xs leading-relaxed text-text-tertiary">
                Elle reste ici, avec ses questions, mais plus aucun répondant ne la voit.
                C&apos;est la façon de mettre une étape de côté sans rien perdre.
              </p>
            </div>
          </div>
        </div>

        {canDelete && (
          <div className="border-t border-border pt-5">
            <button
              type="button"
              onClick={onDelete}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border-strong px-3 py-2 text-xs font-medium text-danger transition hover:border-danger hover:bg-danger/5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Supprimer la section et ses {fieldCount} question
              {fieldCount > 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
