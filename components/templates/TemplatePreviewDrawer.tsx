'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Award, GitBranch, Sparkles, X } from 'lucide-react';
import { FIELD_META } from '@/lib/field-meta';
import { fetchGlobalTemplateDefinition } from '@/lib/store/templates';
import { cn } from '@/lib/utils';
import type { TemplateDefinition, TemplateField } from '@/lib/templates/types';
import type { TemplateIndexEntry } from '@/lib/templates/types';
import { resolveTemplateIcon } from './template-icons';
import { modeLabel } from './TemplateCard';

/**
 * Tiroir d'aperçu d'un modèle.
 *
 * Charge la définition complète à l'ouverture — c'est le seul moment où les
 * ~12 Ko d'un modèle sont nécessaires. La galerie, elle, ne travaille que sur
 * l'index.
 *
 * L'aperçu montre la structure (pages, questions, options, règles), pas un rendu
 * du formulaire : ce qui intéresse quelqu'un qui hésite entre deux modèles,
 * c'est ce qu'on lui demandera, pas la couleur des boutons.
 */

interface Props {
  entry: TemplateIndexEntry;
  busy: boolean;
  onClose: () => void;
  onUse: () => void;
}

export function TemplatePreviewDrawer({ entry, busy, onClose, onUse }: Props) {
  const [def, setDef] = useState<TemplateDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDef(null);
    setError(null);

    fetchGlobalTemplateDefinition(entry.slug)
      .then((loaded) => {
        if (!cancelled) setDef(loaded);
      })
      .catch(() => {
        if (!cancelled) setError('Ce modèle n’a pas pu être chargé.');
      });

    return () => {
      cancelled = true;
    };
  }, [entry.slug]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const Icon = resolveTemplateIcon(entry.icon);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
        role="dialog"
        aria-modal="true"
        aria-label={`Aperçu du modèle ${entry.title.fr}`}
        className="relative z-10 flex h-full w-full max-w-2xl flex-col border-l border-border bg-bg-base shadow-2xl"
      >
        {/* En-tête */}
        <header className="flex items-start gap-3 border-b border-border p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bg-elevated text-text-secondary">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl leading-tight">{entry.title.fr}</h2>
            <p className="papyrus-meta mt-0.5 text-xs">{entry.template_description.fr}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-text-tertiary">
              <span className="rounded bg-bg-elevated px-2 py-0.5">{entry.category}</span>
              <span className="rounded bg-bg-elevated px-2 py-0.5">
                {modeLabel(entry.display_mode)}
              </span>
              <span className="rounded bg-bg-elevated px-2 py-0.5">
                {entry.field_count} champ{entry.field_count > 1 ? 's' : ''}
              </span>
              {entry.page_count > 0 && (
                <span className="rounded bg-bg-elevated px-2 py-0.5">
                  {entry.page_count} page{entry.page_count > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-tertiary transition hover:bg-bg-elevated hover:text-text-primary"
            aria-label="Fermer l’aperçu"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto p-5">
          {error ? (
            <p className="py-10 text-center text-sm text-danger">{error}</p>
          ) : !def ? (
            <SkeletonList />
          ) : (
            <TemplateStructure def={def} />
          )}
        </div>

        {/* Pied */}
        <footer className="border-t border-border p-4">
          <button
            type="button"
            onClick={onUse}
            disabled={busy}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-mooove-ice transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Sparkles className="h-4 w-4" />
            {busy ? 'Création du formulaire…' : 'Utiliser ce modèle'}
          </button>
        </footer>
      </motion.aside>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border p-4">
          <div className="h-3 w-1/3 animate-pulse rounded bg-bg-elevated" />
          <div className="mt-2 h-2.5 w-2/3 animate-pulse rounded bg-bg-elevated" />
        </div>
      ))}
    </div>
  );
}

/** Structure du modèle : les questions groupées par page, puis les règles. */
function TemplateStructure({ def }: { def: TemplateDefinition }) {
  // Les modèles paginés commencent par un `section_break` : on découpe dessus
  // pour retrouver les pages telles que le répondant les verra.
  const pages: { title: string | null; fields: TemplateField[] }[] = [];
  for (const field of def.fields) {
    if (field.type === 'section_break') {
      pages.push({ title: field.label.fr || 'Section', fields: [] });
      continue;
    }
    if (pages.length === 0) pages.push({ title: null, fields: [] });
    pages[pages.length - 1].fields.push(field);
  }

  const labelOf = (id: string) =>
    def.fields.find((f) => f.id === id)?.label.fr ?? id;

  return (
    <div className="space-y-6">
      {def.scoring_enabled && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-bg-surface p-3 text-xs text-text-secondary">
          <Award className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-cta" />
          <span>
            Formulaire noté : des points sont attribués aux réponses
            {def.show_score_to_respondent ? ', et le score est affiché au répondant.' : '.'}
          </span>
        </div>
      )}

      {pages.map((page, index) => (
        <section key={index}>
          {page.title && (
            <h3 className="mb-2 font-display text-sm font-bold text-text-primary">
              {pages.length > 1 && (
                <span className="mr-1.5 text-text-tertiary">Page {index + 1} ·</span>
              )}
              {page.title}
            </h3>
          )}
          <ul className="space-y-2">
            {page.fields.map((field) => (
              <FieldRow key={field.id} field={field} />
            ))}
          </ul>
        </section>
      ))}

      {def.logic_rules.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 font-display text-sm font-bold text-text-primary">
            <GitBranch className="h-3.5 w-3.5 text-text-secondary" />
            Logique conditionnelle
          </h3>
          <ul className="space-y-1.5">
            {def.logic_rules.map((rule) => (
              <li
                key={rule.id}
                className="rounded-xl border border-border bg-bg-surface px-3 py-2 text-xs text-text-secondary"
              >
                <span className="text-text-tertiary">Si </span>
                {rule.conditions
                  .map((c) => `« ${labelOf(c.source_field_id)} »`)
                  .join(rule.conditions_operator === 'OR' ? ' ou ' : ' et ')}
                <span className="text-text-tertiary"> → </span>
                {actionLabel(rule.action_type)}
                {rule.target_field_id && (
                  <span className="text-text-primary"> « {labelOf(rule.target_field_id)} »</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FieldRow({ field }: { field: TemplateField }) {
  const meta = FIELD_META[field.type];
  const options = field.options ?? [];

  return (
    <li className="rounded-xl border border-border bg-bg-surface px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-text-primary">
            {field.label.fr || <span className="text-text-tertiary">Sans titre</span>}
            {field.required && <span className="ml-1 text-danger">*</span>}
          </p>
          {field.description?.fr && (
            <p className="papyrus-meta mt-0.5 text-[11px]">{field.description.fr}</p>
          )}
        </div>
        <span className="shrink-0 rounded bg-bg-elevated px-2 py-0.5 text-[10px] text-text-tertiary">
          {meta?.label ?? field.type}
        </span>
      </div>

      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {options.slice(0, 8).map((option) => (
            <span
              key={option.id}
              className={cn(
                'rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-tertiary',
                option.points !== undefined && 'ring-1 ring-accent-cta/40'
              )}
              title={option.points !== undefined ? `${option.points} point(s)` : undefined}
            >
              {option.label.fr}
              {option.points !== undefined && (
                <span className="ml-1 text-accent-cta">+{option.points}</span>
              )}
            </span>
          ))}
          {options.length > 8 && (
            <span className="px-1 text-[10px] text-text-tertiary">
              +{options.length - 8} autres
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function actionLabel(action: string): string {
  switch (action) {
    case 'show_field':
      return 'afficher';
    case 'hide_field':
      return 'masquer';
    case 'jump_to':
      return 'aller à';
    case 'end_form':
      return 'terminer le formulaire';
    default:
      return action;
  }
}
