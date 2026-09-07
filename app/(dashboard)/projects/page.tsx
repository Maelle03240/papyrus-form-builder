'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, FolderOpen, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { ProjectRow } from '@/components/dashboard/ProjectRow';
import { listProjects, createProject, readActiveTeamId } from '@/lib/store';
import { createClient } from '@/lib/supabase/client';
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

  const [isCreateOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

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

  /**
   * Résout l'espace de travail dans lequel créer le projet.
   *
   * Le cookie d'espace actif n'est écrit que par le sélecteur de la barre
   * latérale : un compte qui vient d'être créé ne l'a pas encore, et créer un
   * projet est justement la première chose qu'il fera. On interroge donc
   * l'appartenance réelle en repli, plutôt que d'échouer.
   */
  const resolveTeamId = useCallback(async (): Promise<string> => {
    const fromCookie = readActiveTeamId();
    if (fromCookie) return fromCookie;

    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Session expirée.');

    const { data, error: membershipError } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError || !data?.team_id) {
      throw new Error("Aucun espace de travail disponible pour ce compte.");
    }
    return data.team_id as string;
  }, []);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;

    setCreating(true);
    try {
      const project = await createProject({ name, teamId: await resolveTeamId() });
      setCreateOpen(false);
      setNewName('');
      router.push(`/projects/${project.id}`);
    } catch (err) {
      console.error('Failed to create project:', err);
      toast.error(err instanceof Error ? err.message : 'Le projet n’a pas pu être créé.');
    } finally {
      setCreating(false);
    }
  }, [newName, resolveTeamId, router]);

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
        <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
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
            onCreate={() => setCreateOpen(true)}
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

      <Modal isOpen={isCreateOpen} onClose={() => setCreateOpen(false)} title="Nouveau projet">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <Input
            autoFocus
            label="Nom du projet"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Conférence du 29 juillet"
          />
          <p className="text-xs text-text-tertiary">
            Vous pourrez ajouter des formulaires, la marque et les partenaires une fois le projet
            ouvert.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" size="sm" loading={creating} disabled={!newName.trim()}>
              Créer le projet
            </Button>
          </div>
        </form>
      </Modal>
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
