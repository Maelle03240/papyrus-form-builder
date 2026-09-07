'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { Project } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { formatRelativeTime } from '@/lib/utils';

/**
 * Une ligne de la liste des projets.
 *
 * Une ligne, et non une carte : les formulaires sont déjà présentés en cartes,
 * et donner le même traitement au conteneur et à son contenu efface la
 * hiérarchie. Une liste se parcourt aussi mieux quand chaque entrée porte des
 * chiffres à comparer d'une ligne à l'autre.
 */

const MODULE_LABELS: Record<string, string> = {
  pricing: 'Tarification',
  partners: 'Partenaires',
  invoicing: 'Facturation',
  email: 'E-mails'
};

export function ProjectRow({ project }: { project: Project }) {
  const activeModules = Object.entries(project.modules)
    .filter(([, enabled]) => enabled)
    .map(([key]) => MODULE_LABELS[key])
    .filter(Boolean);

  const count = project.form_count ?? 0;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex items-center gap-4 rounded-xl border border-border bg-bg-surface px-5 py-4 transition hover:border-border-strong focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-cta"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate font-display text-base font-bold text-text-primary transition-colors group-hover:text-accent">
            {project.name}
          </h2>
          {project.status === 'archived' && <Badge variant="closed">Archivé</Badge>}
        </div>

        {project.description && (
          <p className="mt-0.5 truncate text-sm text-text-secondary">{project.description}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
          <span className="tabular-nums">
            {count} formulaire{count > 1 ? 's' : ''}
          </span>
          <span aria-hidden="true">·</span>
          <span>Modifié {formatRelativeTime(project.updated_at)}</span>
          {activeModules.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{activeModules.join(', ')}</span>
            </>
          )}
        </div>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary transition group-hover:translate-x-0.5 group-hover:text-text-secondary" />
    </Link>
  );
}
