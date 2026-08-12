'use client';

import { Eye, Sparkles, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveTemplateIcon } from './template-icons';
import type { TemplateIndexEntry } from '@/lib/templates/types';

/**
 * Carte d'un modèle du catalogue.
 *
 * L'étoile favori est en `--mooove-electric` et non en Ambre. La charte interdit
 * de mêler Ambre et Cyan dans un même bloc visuel : en mode sombre, `--accent`
 * — la couleur du bouton « Utiliser » — vaut le Cyan, et l'ancienne étoile
 * ambrée créait précisément cette paire interdite sur chaque carte.
 */

export function modeLabel(mode: string): string {
  return mode === 'typeform' ? 'Une à une' : mode === 'scroll' ? 'Défilement' : 'Pages';
}

interface Props {
  entry: TemplateIndexEntry;
  favorite: boolean;
  busy?: boolean;
  onUse: () => void;
  onPreview: () => void;
  onToggleFavorite: () => void;
}

export function TemplateCard({
  entry,
  favorite,
  busy,
  onUse,
  onPreview,
  onToggleFavorite
}: Props) {
  const Icon = resolveTemplateIcon(entry.icon);

  return (
    <div className="group flex flex-col rounded-2xl border border-border bg-bg-surface p-5 transition duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bg-elevated text-text-secondary">
          <Icon className="h-5 w-5" />
        </div>
        <button
          type="button"
          onClick={onToggleFavorite}
          className={cn(
            'rounded p-1.5 transition',
            favorite
              ? 'text-mooove-electric'
              : 'text-text-tertiary opacity-0 hover:text-mooove-electric group-hover:opacity-100 focus-visible:opacity-100'
          )}
          aria-label={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          title={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        >
          <Star className={cn('h-4 w-4', favorite && 'fill-mooove-electric')} />
        </button>
      </div>

      <h3 className="mt-3 font-display text-lg leading-tight text-text-primary">
        {entry.title.fr}
      </h3>
      <p className="papyrus-meta mt-1 flex-1 text-xs">{entry.template_description.fr}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge>
          {entry.field_count} champ{entry.field_count > 1 ? 's' : ''}
        </Badge>
        <Badge>{modeLabel(entry.display_mode)}</Badge>
        {entry.rule_count > 0 && <Badge>Logique</Badge>}
        {entry.scoring_enabled && <Badge>Noté</Badge>}
        {entry.has_matrix && <Badge>Matrice</Badge>}
        {entry.has_media && <Badge>Média</Badge>}
      </div>

      <div className="mt-4 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onPreview}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border-strong px-2.5 py-1.5 text-xs text-text-primary transition hover:border-accent hover:bg-bg-elevated"
        >
          <Eye className="h-3.5 w-3.5" />
          Voir
        </button>
        <button
          type="button"
          onClick={onUse}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-mooove-ice transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {busy ? 'Création…' : 'Utiliser'}
        </button>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-bg-elevated px-2 py-0.5 text-[10px] text-text-tertiary">
      {children}
    </span>
  );
}
