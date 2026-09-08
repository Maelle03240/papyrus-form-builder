'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, FolderOpen, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ProjectRow } from '@/components/dashboard/ProjectRow';
import { listProjects } from '@/lib/store';
import type { Project } from '@/types';

/**
 * Liste des projets — la porte d'entrée du produit.
 *
 * C'est ici que « Nouveau formulaire » est devenu « Nouveau projet » : on ne
 * crée plus un formulaire isolé, on ouvre un projet qui en contiendra un ou
 * plusieurs, avec sa marque, ses partenaires et sa facturation.
 */
export default function ProjectsPage() {
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  /**
   * Créer un projet, c'est ouvrir l'assistant de création — jamais autre chose.
   *
   * Cette page posait sa propre question dans une fenêtre : un nom, puis
   * l'espace de travail du projet, vide. Le nouveau venu arrivait donc devant
   * un projet sans formulaire et sans assistant, alors que `/projects/nouveau`
   * existait et faisait exactement le contraire. Deux chemins pour un même
   * geste, et c'est le mauvais que prenait la porte d'entrée du produit.
   */
  const startProject = useCallback(() => router.push('/projects/nouveau'), [router]);

  const load = useCallback(async () => {
    try {
      setError(null);
      setProjects(await listProjects());
    } catch (err) {
      console.error('Failed to load projects:', err);
      setError("Les projets n'ont pas pu être chargés.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects
      .filter((p) => (showArchived ? p.status === 'archived' : p.status === 'active'))
      .filter(
        (p) =>
          !needle ||
          p.name.toLowerCase().includes(needle) ||
          p.description.toLowerCase().includes(needle)
      );
  }, [projects, query, showArchived]);

  const archivedCount = useMemo(
    () => projects.filter((p) => p.status === 'archived').length,
    [projects]
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Projets</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Un projet regroupe les formulaires d&apos;une même opération, avec sa marque et ses
            partenaires.
          </p>
        </div>
        <Button iconLeft={<Plus className="h-4 w-4" />} onClick={startProject}>
          Nouveau projet
        </Button>
      </header>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un projet"
            aria-label="Rechercher un projet"
            className="h-9 w-full rounded-md border border-border bg-bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden"
          />
        </div>
        {archivedCount > 0 && (
          <Button
            variant={showArchived ? 'secondary' : 'ghost'}
            size="sm"
            iconLeft={<Archive className="h-3.5 w-3.5" />}
            onClick={() => setShowArchived((value) => !value)}
          >
            Archivés <span className="tabular-nums">{archivedCount}</span>
          </Button>
        )}
      </div>

      <div className="mt-6">
        {loading ? (
          <ul className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((row) => (
              <li key={row} className="h-20 animate-pulse rounded-xl border border-border bg-bg-surface" />
            ))}
          </ul>
        ) : error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 px-5 py-4">
            <p className="text-sm text-text-primary">{error}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
              Réessayer
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            archived={showArchived}
            searching={query.trim().length > 0}
            onCreate={startProject}
          />
        ) : (
          <ul className="space-y-2">
            {visible.map((project) => (
              <li key={project.id}>
                <ProjectRow project={project} />
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  );
}

function EmptyState({
  archived,
  searching,
  onCreate
}: {
  archived: boolean;
  searching: boolean;
  onCreate: () => void;
}) {
  if (searching) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
        <p className="text-sm text-text-secondary">Aucun projet ne correspond à cette recherche.</p>
      </div>
    );
  }

  if (archived) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
        <p className="text-sm text-text-secondary">Aucun projet archivé.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center">
      <FolderOpen className="mx-auto h-6 w-6 text-text-tertiary" />
      <h2 className="mt-4 font-display text-lg font-bold text-text-primary">
        Aucun projet pour l&apos;instant
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">
        Un projet réunit tout ce qui concerne une même opération : ses formulaires, sa marque, ses
        partenaires et ses réponses.
      </p>
      <Button className="mt-6" iconLeft={<Plus className="h-4 w-4" />} onClick={onCreate}>
        Créer mon premier projet
      </Button>
    </div>
  );
}
