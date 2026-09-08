'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Contact as ContactIcon, Download, Search, Trash2, Users } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { deleteContact, gatherProjectContacts, listContacts, listProjects, getProjectForms } from '@/lib/store';
import type { Contact, Project } from '@/types';

/**
 * Le carnet d'adresses d'un espace de travail.
 *
 * mooove-invoice ne constitue ses contacts qu'à l'ARCHIVAGE d'un projet. C'est
 * trop tard : on veut écrire aux inscrits pendant l'événement, pas seulement
 * après. Ici le geste est explicite — « Rassembler les contacts » — et
 * rejouable : chaque nouvelle inscription s'ajoute au passage suivant, aucune
 * n'est dupliquée.
 *
 * Les réponses annulées sont exclues, comme partout depuis la phase 5. Une
 * inscription annulée ne laisse pas un contact derrière elle.
 */

interface Props {
  teamId: string;
}

export function ContactBook({ teamId }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('');
  const [gathering, setGathering] = useState('');
  const [removing, setRemoving] = useState<Contact | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, allProjects] = await Promise.all([listContacts(teamId), listProjects()]);
      setContacts(rows);
      setProjects(allProjects.filter((item) => item.team_id === teamId));
    } catch (error) {
      console.error('Failed to load contacts:', error);
      toast.error("Le carnet d'adresses n'a pas pu être chargé.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (project && contact.project_id !== project) return false;
      if (!term) return true;
      return `${contact.name} ${contact.email} ${contact.company} ${contact.project_name}`
        .toLowerCase()
        .includes(term);
    });
  }, [contacts, project, search]);

  async function gather(projectId: string) {
    const target = projects.find((item) => item.id === projectId);
    if (!target) return;

    setGathering(projectId);
    try {
      const forms = await getProjectForms(projectId);
      const result = await gatherProjectContacts(target, forms);

      if (result.added === 0 && result.existing === 0) {
        toast.info('Aucune réponse à rassembler dans ce projet.');
      } else {
        // Les trois chiffres sont dits, pas seulement le premier : « 0 ajouté »
        // sur un projet de deux cents réponses ne veut rien dire sans « 200
        // déjà présents » à côté.
        toast.success(
          `${result.added} contact${result.added > 1 ? 's' : ''} ajouté${
            result.added > 1 ? 's' : ''
          } · ${result.existing} déjà présent${result.existing > 1 ? 's' : ''}${
            result.skipped > 0 ? ` · ${result.skipped} sans adresse` : ''
          }`
        );
      }

      await load();
    } catch (error) {
      console.error('Failed to gather contacts:', error);
      toast.error("Les contacts n'ont pas pu être rassemblés.");
    } finally {
      setGathering('');
    }
  }

  async function remove(contact: Contact) {
    try {
      await deleteContact(contact.id);
      setContacts((previous) => previous.filter((row) => row.id !== contact.id));
    } catch (error) {
      console.error('Failed to delete contact:', error);
      toast.error("Le contact n'a pas pu être supprimé.");
    } finally {
      setRemoving(null);
    }
  }

  const exportHref = `/api/contacts/export?team=${encodeURIComponent(teamId)}${
    project ? `&project=${encodeURIComponent(project)}` : ''
  }${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}`;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Contacts</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Les personnes rencontrées par vos projets, réunies en un carnet qui
            leur survit.
          </p>
        </div>
        <Button
          variant="secondary"
          iconLeft={<Download className="h-4 w-4" />}
          disabled={visible.length === 0}
          onClick={() => window.open(exportHref, '_blank', 'noopener')}
        >
          Exporter en Excel
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nom, adresse, société"
            aria-label="Rechercher un contact"
            className="h-10 w-full rounded-lg border border-border bg-bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-tertiary"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Filtrer par projet</span>
          <select
            value={project}
            onChange={(event) => setProject(event.target.value)}
            className="h-10 rounded-lg border border-border bg-bg-surface px-3 text-sm text-text-primary"
          >
            <option value="">Tous les projets</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        {projects.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Rassembler les contacts d’un projet</span>
            <select
              value={gathering}
              disabled={Boolean(gathering)}
              onChange={(event) => void gather(event.target.value)}
              className="h-10 rounded-lg border border-border-strong bg-bg-surface px-3 text-sm text-text-primary"
            >
              <option value="">Rassembler les contacts de…</option>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading ? (
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-bg-elevated" aria-busy="true" />
      ) : contacts.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border-strong bg-bg-surface p-14 text-center">
          <Users className="mx-auto h-10 w-10 text-text-tertiary" />
          <h2 className="mt-4 font-display text-lg font-bold text-text-primary">
            Carnet vide
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
            Choisissez un projet dans « Rassembler les contacts de… » : Papyrus
            en tire les noms, adresses et téléphones de ses réponses.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border-strong bg-bg-surface p-10 text-center text-sm text-text-secondary">
          Aucun contact ne correspond à ces filtres.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-bg-surface">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-border bg-bg-elevated text-xs font-semibold uppercase text-text-secondary">
              <tr>
                <th className="px-4 py-3 min-w-[180px]">Nom</th>
                <th className="px-4 py-3 min-w-[200px]">E-mail</th>
                <th className="px-4 py-3 min-w-[140px]">Téléphone</th>
                <th className="px-4 py-3 min-w-[160px]">Société</th>
                <th className="px-4 py-3 min-w-[160px]">Projet</th>
                <th className="w-12 px-2 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((contact) => (
                <tr key={contact.id} className="transition-colors hover:bg-bg-elevated">
                  <td className="px-4 py-3 text-text-primary">
                    <span className="block max-w-[14rem] truncate">
                      {contact.name || <span className="text-text-tertiary">—</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    <a
                      href={`mailto:${contact.email}`}
                      className="block max-w-[16rem] truncate underline-offset-4 hover:text-accent hover:underline"
                    >
                      {contact.email}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{contact.phone || '—'}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    <span className="block max-w-[12rem] truncate">{contact.company || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-text-tertiary">
                    <span className="block max-w-[12rem] truncate">{contact.project_name}</span>
                  </td>
                  <td className="w-12 px-2 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setRemoving(contact)}
                      className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-bg-surface hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">
                        Supprimer {contact.name || contact.email}
                      </span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-text-tertiary">
          <ContactIcon className="h-3.5 w-3.5" aria-hidden />
          {visible.length} contact{visible.length > 1 ? 's' : ''}
          {visible.length !== contacts.length && ` sur ${contacts.length}`}
        </p>
      )}

      <ConfirmDialog
        isOpen={Boolean(removing)}
        title="Supprimer ce contact ?"
        message={
          removing
            ? `${removing.name || removing.email} disparaîtra du carnet. La réponse dont il vient reste intacte, et un nouveau rassemblement le recréerait.`
            : ''
        }
        confirmLabel="Supprimer"
        variant="danger"
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
