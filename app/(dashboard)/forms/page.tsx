'use client';

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Pencil, Plus, Search, Send, SquareSlash, Trash2, User, Users, X, MoreHorizontal, Copy, Edit2, Upload, Share2, FolderInput, Download, Sparkles, Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useForms } from '@/lib/store/use-forms';
import { createForm, deleteForm, cloneForm, updateForm, importForm } from '@/lib/store';
import { getWorkspace, getWorkspaces } from '@/lib/store/workspaces';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Form, FormStatus, Workspace } from '@/types';
import { ClosingDateModal } from '@/components/dashboard/ClosingDateModal';

type OwnerFilterValue = 'mine' | 'shared';
type OwnerFilter = OwnerFilterValue | null;
type StatusFilter = 'all' | FormStatus;

const OWNER_FILTERS: { value: OwnerFilterValue; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { value: 'mine', label: 'Mes formulaires', icon: User, hint: 'Ceux que vous avez créés' },
  { value: 'shared', label: 'Partagés', icon: Users, hint: 'Ceux de votre équipe' }
];

const STATUS_FILTERS: { value: StatusFilter; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'all', label: 'Tous', icon: FileText },
  { value: 'draft', label: 'Brouillon', icon: Pencil },
  { value: 'published', label: 'Publié', icon: Send },
  { value: 'closed', label: 'Clos', icon: SquareSlash }
];

const cleanJsonString = (input: string): string => {
  let cleaned = input.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '');
    cleaned = cleaned.replace(/\n?```$/, '');
  }
  return cleaned.trim();
};


export default function FormsListPage() {
  const allForms = useForms();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const workspaceIdFromUrl = searchParams.get('workspace');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  // Vide jusqu'à ce que la session soit lue, pour ne rien attribuer par erreur.
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [movingFormId, setMovingFormId] = useState<string | null>(null);
  const [closingDateForm, setClosingDateForm] = useState<Form | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);

  // Charger tous les espaces de travail
  useEffect(() => {
    getWorkspaces()
      .then(setWorkspaces)
      .catch((err) => console.error('Failed to load workspaces:', err));
  }, []);

  // Nom de l'espace de travail filtré par l'URL
  useEffect(() => {
    if (workspaceIdFromUrl) {
      const match = workspaces.find((ws) => ws.id === workspaceIdFromUrl);
      if (match) {
        setWorkspaceName(match.name);
      } else {
        // L'espace n'est pas encore dans la liste chargée : le récupérer seul.
        getWorkspace(workspaceIdFromUrl)
          .then((workspace) => {
            if (workspace) setWorkspaceName(workspace.name);
          })
          .catch((err) => console.error('Failed to load workspace name:', err));
      }
    } else {
      setWorkspaceName(null);
    }
  }, [workspaceIdFromUrl, workspaces]);

  // Identifiant de l'utilisateur connecté, pour distinguer ses formulaires
  useEffect(() => {
    const loadUser = async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const {
          data: { user }
        } = await createClient().auth.getUser();
        if (user) setCurrentUserId(user.id);
      } catch (error) {
        console.error('Failed to load user session:', error);
      }
    };
    loadUser();
  }, []);

  // Détecter si l'espace courant est personnel (pas de formulaires partagés possibles)
  const isPersonalWorkspace = useMemo(() => {
    if (!workspaceIdFromUrl) return false;
    const ws = workspaces.find((w) => w.id === workspaceIdFromUrl);
    return ws?.scope === 'personal';
  }, [workspaceIdFromUrl, workspaces]);

  // Réinitialiser le filtre propriétaire quand on change d'espace
  useEffect(() => {
    setOwnerFilter(null);
  }, [workspaceIdFromUrl]);

  // On exclut les templates de la liste des formulaires, et on filtre par workspace si spécifié.
  const userForms = useMemo(() => {
    let list = allForms.filter((f) => !f.is_template);
    if (workspaceIdFromUrl) {
      list = list.filter((f) => f.team_id === workspaceIdFromUrl || f.workspace_id === workspaceIdFromUrl);
    }
    return list;
  }, [allForms, workspaceIdFromUrl]);

  // Compteurs propriété (mine / shared) — indépendants du filtre statut
  const ownerCounts = useMemo(() => {
    let mine = 0;
    let shared = 0;
    for (const f of userForms) {
      if (f.created_by === currentUserId) mine++;
      else shared++;
    }
    return { mine, shared };
  }, [userForms, currentUserId]);

  // Forms restreints au filtre propriétaire — utilisé pour les compteurs de statut + filtrage final
  const ownedForms = useMemo(
    () =>
      ownerFilter === null
        ? userForms
        : userForms.filter((f) =>
            ownerFilter === 'mine' ? f.created_by === currentUserId : f.created_by !== currentUserId
          ),
    [userForms, ownerFilter, currentUserId]
  );

  // Compteurs par statut (sur la sous-liste owner) — reflètent ce que l'utilisateur va voir
  const statusCounts = useMemo(() => {
    const c = { all: ownedForms.length, draft: 0, published: 0, closed: 0 };
    for (const f of ownedForms) c[f.status]++;
    return c;
  }, [ownedForms]);

  // Filtrage final = propriétaire + statut + recherche
  const filtered = useMemo(() => {
    const byStatus = ownedForms.filter((f) => statusFilter === 'all' || f.status === statusFilter);
    if (!search.trim()) return byStatus;
    const q = search.trim().toLowerCase();
    return byStatus.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        (f.description ?? '').toLowerCase().includes(q) ||
        f.slug.toLowerCase().includes(q)
    );
  }, [ownedForms, statusFilter, search]);

  async function handleNew() {
    try {
      const targetWorkspaceId = await resolveTargetWorkspaceId();
      const f = await createForm('Nouveau formulaire', targetWorkspaceId);
      router.push(`/forms/${f.id}/edit`);
    } catch (error) {
      console.error('Failed to create form:', error);
      toast.error('Erreur lors de la création du formulaire');
    }
  }

  function handleDelete(id: string, title: string) {
    setDeleteConfirm({ id, title });
  }

  async function executeDelete() {
    if (!deleteConfirm) return;
    const { id } = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await deleteForm(id);
    } catch (error) {
      console.error('Failed to delete form:', error);
      toast.error('Impossible de supprimer le formulaire. Veuillez réessayer.');
    }
  }

  async function handleDuplicate(id: string) {
    try {
      const cloned = await cloneForm(id);
      if (cloned) {
        toast.success('Formulaire dupliqué !');
      } else {
        toast.error('Erreur lors de la duplication');
      }
    } catch (error) {
      console.error('Failed to duplicate form:', error);
      toast.error('Erreur lors de la duplication');
    }
  }

  async function handleRename(id: string, newTitle: string) {
    try {
      const updated = await updateForm(id, { title: newTitle });
      if (updated) {
        toast.success('Formulaire renommé !');
      } else {
        toast.error('Erreur lors du renommage');
      }
    } catch (error) {
      console.error('Failed to rename form:', error);
      toast.error('Erreur lors du renommage');
    }
  }

  async function handleSaveClosingDate(closesAt: string | null) {
    if (!closingDateForm) return;
    try {
      const updated = await updateForm(closingDateForm.id, { closes_at: closesAt });
      if (updated) {
        toast.success('Date de clôture mise à jour');
      } else {
        toast.error('Erreur lors de la mise à jour de la date de clôture');
      }
    } catch (error) {
      console.error('Failed to update closing date:', error);
      toast.error('Erreur lors de la mise à jour de la date de clôture');
    }
  }

  const handleMoveForm = async (formId: string, targetWorkspaceId: string) => {
    try {
      // L'espace de travail d'un formulaire, c'est son team_id.
      await updateForm(formId, { team_id: targetWorkspaceId });
      toast.success('Formulaire déplacé avec succès !');
      setMovingFormId(null);
    } catch (err) {
      console.error('Error moving form:', err);
      toast.error('Erreur lors du déplacement du formulaire');
    }
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Fallback copy failed', err);
      }
      document.body.removeChild(textarea);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Réinitialiser la valeur pour permettre le ré-import du même fichier
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const jsonText = event.target?.result as string;
        const cleanedText = cleanJsonString(jsonText);
        const parsed = JSON.parse(cleanedText);
        
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Le contenu du fichier JSON est invalide');
        }
        if (!parsed.title) {
          throw new Error('Le formulaire JSON doit contenir un titre (title)');
        }

        const targetWorkspaceId = await resolveTargetWorkspaceId();
        const newForm = await importForm(parsed, targetWorkspaceId);
        toast.success('Formulaire importé avec succès !');
        router.push(`/forms/${newForm.id}/edit`);
      } catch (err: any) {
        console.error('Failed to import JSON form:', err);
        toast.error(`Erreur d'importation : ${err.message || 'Format JSON invalide'}`);
      }
    };
    reader.onerror = () => {
      toast.error('Impossible de lire le fichier');
    };
    reader.readAsText(file);
  };

  /**
   * Espace de destination d'un nouveau formulaire : celui de l'URL si présent,
   * sinon l'espace personnel, sinon le premier disponible.
   *
   * Cette résolution était dupliquée à trois endroits de ce fichier (création,
   * import JSON, génération IA), avec des variantes qui avaient déjà divergé.
   */
  const resolveTargetWorkspaceId = useCallback(async (): Promise<string | undefined> => {
    if (workspaceIdFromUrl) return workspaceIdFromUrl;

    try {
      const list = await getWorkspaces();
      if (list.length === 0) return undefined;
      return (list.find((workspace) => workspace.scope === 'personal') ?? list[0]).id;
    } catch (err) {
      console.error('Failed to resolve target workspace:', err);
      return undefined;
    }
  }, [workspaceIdFromUrl]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".json"
        className="hidden"
      />
      {/* En-tête */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl">
            {workspaceName ? `Formulaires — ${workspaceName}` : 'Formulaires'}
          </h1>
        </div>
        <div className="flex gap-2">
          {/* L'ancienne « importation depuis un brouillon » demandait un objet
              JSON complet à un modèle et l'importait tel quel — un champ
              inventé, un identifiant qui ne désigne rien, une règle logique qui
              pointe dans le vide passaient sans que rien ne les arrête. Le
              brouillon nourrit désormais l'assistant, qui construit en appelant
              des outils validés un par un. */}
          <button
            onClick={() => router.push('/projects/nouveau')}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-bg-surface px-2.5 py-1.5 text-xs font-medium text-text-primary transition hover:bg-bg-elevated hover:border-accent"
          >
            <Sparkles className="h-3.5 w-3.5 text-yellow-500" />
            Construire avec l’assistant
          </button>
          <button
            onClick={handleImportClick}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-xs font-medium text-text-primary transition hover:bg-bg-elevated hover:border-border-strong"
          >
            <Upload className="h-3.5 w-3.5" />
            Importer (JSON)
          </button>
          <button
            onClick={() => router.push('/projects')}
            className="inline-flex items-center gap-1.5 rounded-md border border-mooove-cyan bg-mooove-cyan px-2.5 py-1.5 text-xs font-medium text-black transition hover:bg-mooove-cyan/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Nouveau projet
          </button>
        </div>
      </div>

      {/* Filtres + recherche */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Filtre propriétaire — masqué dans les espaces personnels */}
          {!isPersonalWorkspace && (
            <div className="flex gap-1 rounded-md border border-border bg-bg-surface p-0.5">
              {OWNER_FILTERS.map(({ value, label, icon: Icon }) => {
                const active = ownerFilter === value;
                const count = ownerCounts[value];
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setOwnerFilter(active ? null : value)}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm transition',
                      active
                        ? 'bg-bg-elevated text-text-primary'
                        : 'text-text-secondary hover:text-text-primary'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px]',
                        active ? 'bg-accent/10 text-accent' : 'bg-bg-elevated text-text-tertiary'
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un formulaire…" />
        </div>

        {/* Filtre statut — chips libres */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-text-tertiary">Statut :</span>
          {STATUS_FILTERS.map(({ value, label, icon: Icon }) => {
            const active = statusFilter === value;
            const count = statusCounts[value];
            return (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
                  active
                    ? 'border-accent bg-accent/5 text-text-primary'
                    : 'border-border-strong text-text-secondary hover:border-accent'
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
                <span className={cn('text-[10px]', active ? 'text-accent' : 'text-text-tertiary')}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {ownerFilter !== null && (
        <p className="papyrus-meta -mt-3 text-xs">
          i. {OWNER_FILTERS.find((f) => f.value === ownerFilter)?.hint}
        </p>
      )}

      {/* Contenu */}
      {filtered.length === 0 ? (
        <EmptyState
          isSearch={!!search.trim()}
          ownerFilter={ownerFilter}
          statusFilter={statusFilter}
          onCreate={handleNew}
          onClearSearch={() => setSearch('')}
          onClearStatus={() => setStatusFilter('all')}
        />
      ) : (
        <FormsTable
          forms={filtered}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onRename={handleRename}
          onMoveForm={(formId) => setMovingFormId(formId)}
          onEditClosingDate={(form) => setClosingDateForm(form)}
          onShareForm={(url) => {
            copyToClipboard(url);
            toast.success('Lien de partage copié !');
          }}
        />
      )}

      {/* Modal de Déplacement de Formulaire */}
      {movingFormId && typeof window !== 'undefined' && createPortal(
        <Modal
          isOpen={!!movingFormId}
          onClose={() => setMovingFormId(null)}
          title="Changer d'espace de travail"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary font-body">
              Choisissez l'espace de travail cible pour déplacer ce formulaire :
            </p>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {workspaces.map((ws) => {
                const form = movingFormId ? filtered.find(f => f.id === movingFormId) : null;
                const isCurrent = form?.team_id === ws.id;

                return (
                  <button
                    key={ws.id}
                    onClick={() => {
                      if (!isCurrent && movingFormId) {
                        handleMoveForm(movingFormId, ws.id);
                      }
                    }}
                    disabled={isCurrent}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border p-3 text-left transition text-sm",
                      isCurrent
                        ? "border-accent bg-accent/5 text-text-primary cursor-default opacity-60"
                        : "border-border hover:border-border-strong hover:bg-bg-elevated text-text-secondary hover:text-text-primary"
                    )}
                  >
                    <span className="font-medium font-body">{ws.name}</span>
                    {isCurrent && <span className="text-xs font-body text-accent bg-accent/10 px-2 py-0.5 rounded-full">Actuel</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMovingFormId(null)}
              >
                Annuler
              </Button>
            </div>
          </div>
        </Modal>,
        document.body
      )}

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={executeDelete}
        title="Supprimer ce formulaire ?"
        message={`« ${deleteConfirm?.title ?? ''} » sera supprimé définitivement. Cette action est irréversible.`}
        confirmLabel="Supprimer"
      />

      <ClosingDateModal
        isOpen={!!closingDateForm}
        onClose={() => setClosingDateForm(null)}
        initialClosesAt={closingDateForm ? closingDateForm.closes_at || null : null}
        onSave={handleSaveClosingDate}
        formTitle={closingDateForm ? closingDateForm.title : ''}
      />
    </div>
  );
}

// ============================================================================
// Barre de recherche réutilisable
// ============================================================================
function SearchBar({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border bg-bg-surface pl-8 pr-8 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Effacer la recherche"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-text-tertiary transition hover:bg-bg-elevated hover:text-text-primary"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Tableau
// ============================================================================
function FormsTable({
  forms,
  onDelete,
  onDuplicate,
  onRename,
  onMoveForm,
  onShareForm,
  onEditClosingDate
}: {
  forms: Form[];
  onDelete: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onMoveForm: (id: string) => void;
  onShareForm: (url: string) => void;
  onEditClosingDate: (form: Form) => void;
}) {
  const router = useRouter();
  const [editingFormId, setEditingFormId] = useState<string | null>(null);
  const [editFormTitle, setEditFormTitle] = useState('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  const handleOpenMenu = (formId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 4,
      left: rect.right - 200
    });
    setActiveMenuId(formId);
  };

  const handleExportJson = (formId: string) => {
    const form = forms.find(f => f.id === formId);
    if (!form) return;

    try {
      const cleanForm = { ...form };
      // Supprimer les champs de réponses et de statistiques pour ne garder que le design
      delete (cleanForm as any).responses_count;
      delete (cleanForm as any).completion_rate;
      
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cleanForm, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      const filename = `${(form.title || 'formulaire').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_export.json`;
      downloadAnchor.setAttribute("download", filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (error) {
      console.error('Failed to export JSON:', error);
      toast.error('Une erreur est survenue lors de l\'exportation');
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-surface">
      <table className="w-full">
        <thead className="border-b border-border bg-bg-elevated/50 text-left text-xs uppercase tracking-wide text-text-secondary">
          <tr>
            <th className="px-4 py-3 font-medium">Titre</th>
            <th className="px-4 py-3 font-medium">Statut</th>
            <th className="px-4 py-3 font-medium">Mode</th>
            <th className="px-4 py-3 font-medium">Mis à jour</th>
            <th className="w-12 px-4 py-3 font-medium text-left">ACTION</th>
          </tr>
        </thead>
        <tbody>
          {forms.map((f, i) => (
            <tr key={f.id} className={i < forms.length - 1 ? 'border-b border-dashed border-border' : ''}>
              <td className="px-4 py-3">
                {editingFormId === f.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editFormTitle.trim() && editFormTitle.trim() !== f.title) {
                        onRename(f.id, editFormTitle.trim());
                      }
                      setEditingFormId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-2 w-full max-w-md"
                  >
                    <input
                      type="text"
                      value={editFormTitle}
                      onChange={(e) => setEditFormTitle(e.target.value)}
                      className="h-8 w-full rounded-md border border-border-strong bg-bg-surface px-2.5 text-sm focus:border-accent focus:outline-hidden"
                      autoFocus
                      onBlur={() => {
                        if (editFormTitle.trim() && editFormTitle.trim() !== f.title) {
                          onRename(f.id, editFormTitle.trim());
                        }
                        setEditingFormId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingFormId(null);
                      }}
                    />
                  </form>
                ) : (
                  <>
                    <Link href={`/forms/${f.id}`} className="font-display text-base hover:underline">
                      {f.title}
                    </Link>
                    <div className="text-xs text-text-tertiary flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span>/{f.slug}</span>
                      {f.closes_at && (
                        <>
                          <span>·</span>
                          <span className={`font-medium ${new Date(f.closes_at) > new Date() ? 'text-orange-500' : 'text-red-500'}`}>
                            {new Date(f.closes_at) > new Date()
                              ? `Clôture le ${new Date(f.closes_at).toLocaleDateString('fr-FR')} à ${new Date(f.closes_at).toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'})}`
                              : 'Date dépassée'
                            }
                          </span>
                        </>
                      )}
                    </div>
                  </>
                )}
              </td>
              <td className="px-4 py-3">
                {f.status === 'published' && <Badge variant="published" className="text-xs px-2 py-1">Publié</Badge>}
                {f.status === 'draft' && <Badge variant="draft" className="text-xs px-2 py-1">Brouillon</Badge>}
                {f.status === 'closed' && <Badge variant="closed" className="text-xs px-2 py-1">Clos</Badge>}
              </td>
              <td className="px-4 py-3 text-sm capitalize text-text-secondary">{f.display_mode}</td>
              <td className="px-4 py-3 text-sm text-text-secondary">
                {new Date(f.updated_at).toLocaleDateString('fr-FR')}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end">
                  <button
                    onClick={(e) => handleOpenMenu(f.id, e)}
                    className="p-1 rounded-sm text-text-tertiary hover:bg-bg-elevated hover:text-text-primary transition"
                    aria-label="Options"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {activeMenuId && menuPosition && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setActiveMenuId(null)} />
          <div
            className="fixed z-50 min-w-[200px] rounded-lg border border-border bg-bg-surface p-1.5 shadow-lg animate-in fade-in duration-100"
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
            }}
          >
            <button
              onClick={() => {
                router.push(`/forms/${activeMenuId}/edit`);
                setActiveMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
            >
              <Edit2 className="h-4 w-4 text-text-tertiary" />
              Modifier
            </button>
            <button
              onClick={() => {
                const form = forms.find(f => f.id === activeMenuId);
                if (form) {
                  setEditingFormId(activeMenuId);
                  setEditFormTitle(form.title);
                }
                setActiveMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
            >
              <Edit2 className="h-4 w-4 text-text-tertiary" />
              Renommer
            </button>
            <button
              onClick={() => {
                const form = forms.find(f => f.id === activeMenuId);
                if (form) {
                  const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/f/${form.slug}`;
                  onShareForm(url);
                }
                setActiveMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
            >
              <Share2 className="h-4 w-4 text-text-tertiary" />
              Copier le lien de partage
            </button>
             <button
              onClick={() => {
                onMoveForm(activeMenuId);
                setActiveMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
            >
              <FolderInput className="h-4 w-4 text-text-tertiary" />
              Changer d'espace de travail
            </button>
            <button
              onClick={() => {
                const form = forms.find(f => f.id === activeMenuId);
                if (form) {
                  onEditClosingDate(form);
                }
                setActiveMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
            >
              <Clock className="h-4 w-4 text-text-tertiary" />
              Date de clôture
            </button>
            <button
              onClick={() => {
                onDuplicate(activeMenuId);
                setActiveMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
            >
              <Copy className="h-4 w-4 text-text-tertiary" />
              Dupliquer
            </button>
            <button
              onClick={() => {
                handleExportJson(activeMenuId);
                setActiveMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
            >
              <Download className="h-4 w-4 text-text-tertiary" />
              Exporter (JSON)
            </button>
            <div className="my-2 border-t border-border"></div>
            <button
              onClick={() => {
                const form = forms.find(f => f.id === activeMenuId);
                if (form) {
                  onDelete(activeMenuId, form.title);
                }
                setActiveMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger/5 transition font-semibold rounded-sm"
            >
              <Trash2 className="h-4 w-4" />
              Supprimer
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

// ============================================================================
// Empty states
// ============================================================================
function EmptyState({
  isSearch,
  ownerFilter,
  statusFilter,
  onCreate,
  onClearSearch,
  onClearStatus
}: {
  isSearch: boolean;
  ownerFilter: OwnerFilter;
  statusFilter: StatusFilter;
  onCreate: () => void;
  onClearSearch: () => void;
  onClearStatus: () => void;
}) {
  if (isSearch) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-12 text-center">
        <Search className="mx-auto h-8 w-8 text-text-tertiary" />
        <h3 className="mt-3 font-display text-lg">Aucun résultat</h3>
        <p className="papyrus-meta mt-1 text-sm">i. Aucun formulaire ne correspond à votre recherche.</p>
        <button
          type="button"
          onClick={onClearSearch}
          className="mt-3 inline-flex items-center gap-1 text-sm text-accent hover:underline"
        >
          <X className="h-3.5 w-3.5" /> Effacer la recherche
        </button>
      </div>
    );
  }

  if (statusFilter !== 'all') {
    const statusLabel = STATUS_FILTERS.find((s) => s.value === statusFilter)?.label.toLowerCase() ?? '';
    return (
      <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-12 text-center">
        <SquareSlash className="mx-auto h-8 w-8 text-text-tertiary" />
        <h3 className="mt-3 font-display text-lg">Aucun formulaire en {statusLabel}</h3>
        <p className="papyrus-meta mt-1 text-sm">
          i. Rien à afficher avec ce filtre{ownerFilter === 'mine' ? ' dans vos formulaires' : ownerFilter === 'shared' ? ' dans les partagés' : ''}.
        </p>
        <button
          type="button"
          onClick={onClearStatus}
          className="mt-3 inline-flex items-center gap-1 text-sm text-accent hover:underline"
        >
          <X className="h-3.5 w-3.5" /> Voir tous les statuts
        </button>
      </div>
    );
  }

  if (ownerFilter === 'shared') {
    return (
      <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-12 text-center">
        <Users className="mx-auto h-8 w-8 text-text-tertiary" />
        <h3 className="mt-3 font-display text-lg">Aucun formulaire partagé</h3>
        <p className="papyrus-meta mt-1 text-sm">
          i. Quand un membre de votre équipe partagera un formulaire, il apparaîtra ici.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-16 text-center">
      <FileText className="mx-auto h-10 w-10 text-text-tertiary" />
      <h3 className="mt-4 font-display text-xl">Aucun formulaire pour l&apos;instant</h3>
      <p className="papyrus-meta mt-1 text-sm">i. Commencez par créer votre premier Papyrus</p>
      <button
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-1.5 rounded-md border border-mooove-cyan bg-mooove-cyan px-2.5 py-1.5 text-xs font-medium text-black transition hover:bg-mooove-cyan/90"
      >
        <Plus className="h-3.5 w-3.5" />
        Créer un formulaire
      </button>
    </div>
  );
}
