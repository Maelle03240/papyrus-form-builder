'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  FileText,
  Settings,
  CreditCard,
  Users,
  User,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
  LogOut,
  X,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  Edit2,
  Copy,
  Trash2,
  FolderInput,
  FolderOpen,
  Handshake,
  Share2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { getWorkspaces, createWorkspace, updateWorkspace, deleteWorkspace } from '@/lib/store/workspaces';
import type { Workspace, Form, WorkspaceScope } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { cloneForm, deleteForm, updateForm } from '@/lib/store';

/**
 * Adresse d'un formulaire dans l'arborescence de projet.
 *
 * `project_id` est nul sur un modèle, et peut manquer sur une ligne servie par
 * un cache antérieur à la migration : on retombe alors sur l'ancienne adresse,
 * qui fonctionne toujours, plutôt que de construire une URL invalide.
 */
function formHref(form: Form): string {
  return form.project_id ? `/projects/${form.project_id}/forms/${form.id}` : `/forms/${form.id}`;
}

interface Props {
  teamName?: string;
  userEmail?: string;
  activeTeam?: { id: string; name: string; plan: string };
  allTeams?: { id: string; name: string; plan: string }[];
  isCollapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({
  userEmail,
  allTeams,
  isCollapsed = false,
  onToggle
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeWorkspaceId = searchParams.get('workspace');

  // Liste des espaces
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  // État d'ouverture accordéon par workspace ID
  const [openAccordions, setOpenAccordions] = useState<Record<string, boolean>>({});
  
  // Création workspace inline
  const [isCreating, setIsCreating] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  // Rénommage workspace inline
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Renommage formulaire inline
  const [editingFormId, setEditingFormId] = useState<string | null>(null);
  const [editFormTitle, setEditFormTitle] = useState('');

  // Dropdown menu d'options de workspace actif
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [workspaceDropdownPosition, setWorkspaceDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const workspaceMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Suppression modal
  const [deletingWorkspace, setDeletingWorkspace] = useState<Workspace | null>(null);

  // Modal de gestion des membres
  const [managingWorkspace, setManagingWorkspace] = useState<Workspace | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<any[]>([]);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [memberLoading, setMemberLoading] = useState(false);
  const [sendEmailInvite, setSendEmailInvite] = useState(false);

  // Modal de confirmation de suppression de membre
  const [memberToRemove, setMemberToRemove] = useState<{ id: string; email: string } | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  // Suppression formulaire
  const [deletingFormId, setDeletingFormId] = useState<string | null>(null);

  // Menu contextuel formulaire actif
  const [activeFormMenuId, setActiveFormMenuId] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const [movingFormId, setMovingFormId] = useState<string | null>(null);
  const formMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Tous les formulaires accessibles, pour les regrouper par espace de travail
  const [allForms, setAllForms] = useState<Form[]>([]);

  /**
   * Recharge la liste des espaces depuis Supabase.
   *
   * `allTeams`, transmis par le layout serveur, sert d'affichage immédiat pour
   * éviter une sidebar vide au premier rendu ; la requête client prend ensuite
   * le relais avec les métadonnées complètes (scope, suppressible ou non).
   */
  const loadWorkspaces = useCallback(async () => {
    try {
      const list = await getWorkspaces();
      setWorkspaces(list);

      setOpenAccordions((current) =>
        Object.keys(current).length === 0 && list.length > 0 ? { [list[0].id]: true } : current
      );
    } catch (err) {
      console.error('Failed to load workspaces:', err);
    }
  }, []);

  /** Retrouve un formulaire déjà chargé. */
  const findFormById = (formId: string): Form | null =>
    allForms.find((form) => form.id === formId) ?? null;

  const handleRenameFormSubmit = async (formId: string) => {
    if (!editFormTitle.trim()) {
      setEditingFormId(null);
      return;
    }
    try {
      await updateForm(formId, { title: editFormTitle.trim() });
      toast.success('Formulaire renommé !');
    } catch (err) {
      console.error('Error renaming form:', err);
      toast.error('Erreur lors du renommage');
    } finally {
      setEditingFormId(null);
    }
  };

  const handleDuplicateForm = async (formId: string) => {
    try {
      const cloned = await cloneForm(formId);
      if (cloned) {
        toast.success('Formulaire dupliqué !');
      } else {
        toast.error('Erreur lors de la duplication');
      }
    } catch (err) {
      console.error('Error duplicating form:', err);
      toast.error('Erreur lors de la duplication');
    }
  };

  const handleDeleteFormClick = (formId: string) => {
    setDeletingFormId(formId);
  };

  const confirmDeleteForm = async () => {
    if (!deletingFormId) return;
    const formId = deletingFormId;
    setDeletingFormId(null);
    try {
      await deleteForm(formId);
      toast.success('Formulaire supprimé !');
      if (pathname === `/forms/${formId}` || pathname === `/forms/${formId}/edit`) {
        router.push('/dashboard');
      }
    } catch (err) {
      console.error('Error deleting form:', err);
      toast.error('Erreur lors de la suppression');
    }
  };

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

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (err) {
      console.warn('Navigator clipboard failed, trying fallback', err);
    }
    
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Fallback copy failed', err);
    }
    document.body.removeChild(textarea);
  };

  // Espaces de travail : rendu immédiat depuis le layout serveur, puis rechargement.
  useEffect(() => {
    if (workspaces.length === 0 && allTeams && allTeams.length > 0) {
      setWorkspaces(
        allTeams.map((team) => ({
          id: team.id,
          name: team.name,
          scope: 'team' as WorkspaceScope,
          is_deletable: true,
          created_by: '',
          created_at: ''
        }))
      );
    }

    loadWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTeams, loadWorkspaces]);

  useEffect(() => {
    const handleWorkspacesChanged = () => {
      loadWorkspaces();
    };
    window.addEventListener('papyrus:workspaces-changed', handleWorkspacesChanged);
    return () => {
      window.removeEventListener('papyrus:workspaces-changed', handleWorkspacesChanged);
    };
  }, [loadWorkspaces]);

  // Formulaires, rechargés à chaque mutation signalée par le store.
  useEffect(() => {
    async function loadAllForms() {
      try {
        const { listForms } = await import('@/lib/store');
        setAllForms(await listForms());
        window.dispatchEvent(new CustomEvent('papyrus:forms-loaded'));
      } catch (err) {
        console.error('Failed to load forms in Sidebar:', err);
      }
    }

    loadAllForms();

    const handleFormsChanged = () => {
      loadAllForms();
    };
    window.addEventListener('papyrus:forms-changed', handleFormsChanged);
    window.addEventListener('papyrus:form-created', handleFormsChanged);
    window.addEventListener('papyrus:form-updated', handleFormsChanged);
    window.addEventListener('papyrus:form-deleted', handleFormsChanged);
    return () => {
      window.removeEventListener('papyrus:forms-changed', handleFormsChanged);
      window.removeEventListener('papyrus:form-created', handleFormsChanged);
      window.removeEventListener('papyrus:form-updated', handleFormsChanged);
      window.removeEventListener('papyrus:form-deleted', handleFormsChanged);
    };
  }, []);

  const toggleAccordion = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenAccordions((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;

    try {
      await createWorkspace(newWorkspaceName.trim());
      setNewWorkspaceName('');
      setIsCreating(false);
      await loadWorkspaces();
      router.refresh();
      toast.success('Espace de travail créé.');
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de la création du workspace');
    }
  };

  const handleStartRename = (ws: Workspace, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(ws.id);
    setRenameValue(ws.name);
    setActiveMenuId(null);
  };

  const handleRenameWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameValue.trim() || !renamingId) return;

    try {
      await updateWorkspace(renamingId, { name: renameValue.trim() });
      setRenamingId(null);
      await loadWorkspaces();
      router.refresh();
      toast.success('Espace de travail renommé.');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Erreur lors de la modification');
    }
  };

  const handleDeleteWorkspaceConfirm = async () => {
    if (!deletingWorkspace) return;

    try {
      await deleteWorkspace(deletingWorkspace.id);
      setDeletingWorkspace(null);
      toast.success('Espace de travail supprimé.');
      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Erreur lors de la suppression');
    }
  };
  // Fonction pour charger les membres de l'équipe
  const loadMembers = async (workspaceId: string) => {
    try {
      const { listTeamMembers } = await import('@/lib/store');
      setWorkspaceMembers(await listTeamMembers(workspaceId));
    } catch (err) {
      console.error('Error loading workspace members:', err);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberEmail.trim() || !managingWorkspace) return;
    setMemberLoading(true);

    try {
      const { addTeamMember } = await import('@/lib/store');
      await addTeamMember(managingWorkspace.id, newMemberEmail.trim(), 'member');

      // Envoyer l'email d'invitation si demandé
      if (sendEmailInvite) {
        try {
          const response = await fetch(`/api/workspaces/${managingWorkspace.id}/invite`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: newMemberEmail.trim(),
              workspaceName: managingWorkspace.name,
              inviterName: userEmail || 'Un collaborateur'
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erreur lors de l\'envoi de l\'email');
          }
        } catch (emailError) {
          console.warn('Email invitation failed:', emailError);
          // N'interrompt pas le processus si l'email échoue
          toast.error('Membre ajouté, mais l\'email d\'invitation n\'a pas pu être envoyé');
        }
      }

      setNewMemberEmail('');
      setSendEmailInvite(false);
      await loadMembers(managingWorkspace.id);

      const message = sendEmailInvite
        ? 'Membre invité et email envoyé avec succès !'
        : 'Membre invité avec succès !';
      toast.success(message);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Erreur lors de l'invitation");
    } finally {
      setMemberLoading(false);
    }
  };

  const handleRemoveMember = (userId: string, userEmail: string) => {
    setMemberToRemove({ id: userId, email: userEmail });
  };

  const confirmRemoveMember = async () => {
    if (!managingWorkspace || !memberToRemove) return;
    setRemoveLoading(true);

    try {
      const { deleteTeamMember } = await import('@/lib/store');
      await deleteTeamMember(managingWorkspace.id, memberToRemove.id);
      await loadMembers(managingWorkspace.id);
      toast.success('Membre retiré.');
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du retrait du membre');
    } finally {
      setRemoveLoading(false);
      setMemberToRemove(null);
    }
  };

  // Positionnement du dropdown de workspace
  const handleOpenWorkspaceMenu = (wsId: string, buttonElement: HTMLButtonElement) => {
    const rect = buttonElement.getBoundingClientRect();
    const dropdownWidth = 160;

    let left = rect.left;
    const top = rect.bottom + 4;

    if (left + dropdownWidth > window.innerWidth - 16) {
      left = window.innerWidth - dropdownWidth - 16;
    }

    if (left < 16) {
      left = 16;
    }

    setWorkspaceDropdownPosition({ top, left });
    setActiveMenuId(wsId);
  };

  const handleCloseWorkspaceMenu = () => {
    setActiveMenuId(null);
    setWorkspaceDropdownPosition(null);
  };
  // Fonction pour ouvrir le dropdown du formulaire avec positionnement dynamique
  const handleOpenFormMenu = (formId: string, buttonElement: HTMLButtonElement) => {
    const rect = buttonElement.getBoundingClientRect();
    const dropdownWidth = 180; // Largeur minimum du dropdown

    let left = rect.left;
    const top = rect.bottom + 4;

    if (left + dropdownWidth > window.innerWidth - 16) {
      left = window.innerWidth - dropdownWidth - 16;
    }

    if (left < 16) {
      left = 16;
    }

    setDropdownPosition({ top, left });
    setActiveFormMenuId(formId);
  };

  const handleCloseFormMenu = () => {
    setActiveFormMenuId(null);
    setDropdownPosition(null);
  };

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  // Navigation statique en bas de la sidebar
  const STATIC_NAV = [
    { href: '/projects', label: 'Projets', icon: FolderOpen },
    { href: '/templates', label: 'Modèles', icon: FileText },
    { href: '/partners', label: 'Partenaires', icon: Handshake },
    { href: '/contacts', label: 'Contacts', icon: Users },
    { href: '/settings', label: 'Paramètres', icon: Settings },
    { href: '/billing', label: 'Billing', icon: CreditCard, badge: 'Bientôt' }
  ];

  const _currentUserEmail = userEmail || 'local@papyrus.dev';

  // État pour l'utilisateur Supabase
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Récupérer l'utilisateur Supabase connecté
  // TODO: v0.2 Supabase — remplacer 'Utilisateur local' par le vrai email de l'utilisateur connecté (supabase.auth.getUser())
  useEffect(() => {
    async function getCurrentUser() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
    }

    getCurrentUser();
  }, []);

  /**
   * Ouvre la liste des projets de l'espace choisi.
   *
   * On n'y crée plus un formulaire directement : un formulaire vit dans un
   * projet, et le nommer d'abord évite la traînée de « Nouveau formulaire »
   * sans contexte que l'ancien bouton produisait.
   */
  const handleCreateProjectInWorkspace = (workspaceId: string) => {
    setOpenAccordions((prev) => ({ ...prev, [workspaceId]: true }));
    document.cookie = `papyrus:active-team-id=${workspaceId}; path=/; max-age=31536000; SameSite=Lax`;
    router.push('/projects');
  };

  // Composant dropdown rendu dans un portail
  const FormDropdownMenu = ({ formId, onClose }: { formId: string; onClose: () => void }) => {
    if (!dropdownPosition) return null;

    return createPortal(
      <>
        {/* Overlay pour fermer le menu */}
        <div
          className="fixed inset-0 z-9998"
          onClick={onClose}
        />
        {/* Menu dropdown */}
        <div
          className="fixed z-9999 rounded-lg border border-border bg-bg-surface p-3 animate-in fade-in duration-100"
          style={{
            minWidth: 'clamp(160px, 20vw, 200px)',
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              router.push(`/forms/${formId}/edit`);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
          >
            <Edit2 className="h-4 w-4 text-text-tertiary" />
            Modifier
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              const f = findFormById(formId);
              if (f) {
                setEditingFormId(formId);
                setEditFormTitle(f.title);
              }
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
          >
            <Edit2 className="h-4 w-4 text-text-tertiary" />
            Renommer
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              const f = findFormById(formId);
              if (f) {
                const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/f/${f.slug}`;
                copyToClipboard(url);
                toast.success('Lien de partage copié !');
              }
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
          >
            <Share2 className="h-4 w-4 text-text-tertiary" />
            Copier le lien de partage
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              setMovingFormId(formId);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
          >
            <FolderInput className="h-4 w-4 text-text-tertiary" />
            Changer d'espace de travail
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              handleDuplicateForm(formId);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
          >
            <Copy className="h-4 w-4 text-text-tertiary" />
            Dupliquer
          </button>
          <div className="my-2 border-t border-border"></div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              handleDeleteFormClick(formId);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger/5 transition font-semibold rounded-sm"
          >
            <Trash2 className="h-4 w-4" />
            Supprimer
          </button>
        </div>
      </>,
      document.body
    );
  };

  // Composant dropdown de workspace rendu dans un portail
  const WorkspaceDropdownMenu = ({ ws, onClose }: { ws: Workspace; onClose: () => void }) => {
    if (!workspaceDropdownPosition) return null;
    const isPersonal = ws.scope === 'personal';

    return createPortal(
      <>
        {/* Overlay pour fermer le menu */}
        <div
          className="fixed inset-0 z-9998"
          onClick={onClose}
        />
        {/* Menu dropdown */}
        <div
          className="fixed z-9999 rounded-lg border border-border bg-bg-surface p-3 animate-in fade-in duration-100"
          style={{
            minWidth: 'clamp(150px, 18vw, 180px)',
            top: workspaceDropdownPosition.top,
            left: workspaceDropdownPosition.left,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              handleStartRename(ws, e);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
          >
            Renommer
          </button>
          {!isPersonal && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                  setManagingWorkspace(ws);
                  loadMembers(ws.id);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded-sm"
              >
                Membres
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                  setDeletingWorkspace(ws);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger/5 transition font-semibold rounded-sm"
              >
                Supprimer
              </button>
            </>
          )}
        </div>
      </>,
      document.body
    );
  };

  return (
    <aside
      style={{ width: isCollapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)' }}
      className={cn(
        "flex h-full flex-col border-r border-border bg-bg-surface select-none transition-all duration-200 overflow-hidden"
      )}
    >
      {/* Logo Papyrus */}
      <div
        className={cn(
          "py-3 flex items-center transition-all duration-200",
          isCollapsed
            ? "px-2 flex-col gap-2 justify-center"
            : "px-4 justify-between"
        )}
      >
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-2 text-left focus:outline-hidden"
        >
          {/* Logo Papyrus */}
          <img
            src="/papyrus-logo.png"
            alt="Papyrus"
            style={{ width: 'var(--sidebar-logo-size)', height: 'var(--sidebar-logo-size)' }}
            className="rounded-xl shrink-0 object-contain"
          />
          {/* Textes */}
          <div className="flex flex-col">
            <span className={cn("font-display text-base xl:text-lg font-semibold text-text-primary leading-tight truncate transition-all duration-200", isCollapsed && "hidden")}>
              Papyrus
            </span>
            <span className={cn("font-body text-xs xl:text-sm text-text-tertiary leading-tight truncate transition-all duration-200", isCollapsed && "hidden")}>
              by Mooove
            </span>
          </div>
        </button>

        <button
          onClick={onToggle}
          className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition shrink-0"
          aria-label={isCollapsed ? "Étendre la sidebar" : "Réduire la sidebar"}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Workspace Section */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        <div>
          <span className={cn("block px-3 text-xs font-semibold uppercase tracking-[0.8px] text-text-tertiary mb-1 truncate transition-all duration-200", isCollapsed && "hidden")}>
            Espaces de travail
          </span>

          <div className="space-y-1">
            {workspaces.map((ws) => {
              const isOpen = !!openAccordions[ws.id];
              const forms = allForms.filter((f) => f.team_id === ws.id);
              const hasForms = forms.length > 0;
              const displayedForms = forms.slice(0, 5);
              const hasMoreForms = forms.length > 5;
              const isPersonal = ws.scope === 'personal';

              return (
                <div key={ws.id} className="group relative rounded-md transition duration-150">
                  {/* Item ligne workspace */}
                  <div
                    onClick={(_e) => {
                      if (renamingId === ws.id) return;
                      router.push(`/forms?workspace=${ws.id}`);
                    }}
                    style={{ height: 'var(--sidebar-item-height)', fontSize: 'var(--sidebar-text-base)' }}
                    className={cn(
                      'flex items-center w-full px-3 font-medium cursor-pointer rounded-md transition hover:bg-bg-elevated text-text-secondary hover:text-text-primary',
                      pathname === '/forms' && activeWorkspaceId === ws.id && 'bg-bg-elevated text-text-primary font-semibold',
                      isCollapsed ? 'justify-center' : 'justify-between gap-2'
                    )}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {isPersonal ? (
                        <User
                          style={{ width: 'var(--sidebar-icon)', height: 'var(--sidebar-icon)' }}
                          className="shrink-0 text-text-tertiary"
                        />
                      ) : (
                        <Users
                          style={{ width: 'var(--sidebar-icon)', height: 'var(--sidebar-icon)' }}
                          className="shrink-0 text-text-tertiary"
                        />
                      )}

                      {renamingId === ws.id ? (
                        <form
                          onSubmit={handleRenameWorkspace}
                          onClick={(e) => e.stopPropagation()}
                          className={cn("flex-1 min-w-0", isCollapsed && "hidden")}
                        >
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => setRenamingId(null)}
                            className="w-full px-1 py-0.5 border border-border bg-bg-surface rounded-sm text-xs font-normal focus:outline-hidden focus:border-accent"
                            autoFocus
                          />
                        </form>
                      ) : (
                        <span
                          style={{ fontSize: 'var(--sidebar-text-base)' }}
                          className={cn("truncate font-medium text-text-primary transition-all duration-200", isCollapsed && "hidden")}
                        >
                          {ws.name}
                        </span>
                      )}
                    </div>

                    {/* Options / Accordion chevrons */}
                    {!isCollapsed && (
                      <div className="flex items-center gap-1">
                        {/* Bouton options 3 points */}
                        {renamingId !== ws.id && !isPersonal && (
                          <div className="relative">
                            <button
                              ref={(el) => {
                                workspaceMenuButtonRefs.current[ws.id] = el;
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const buttonElement = e.currentTarget;
                                if (activeMenuId === ws.id) {
                                  handleCloseWorkspaceMenu();
                                } else {
                                  handleOpenWorkspaceMenu(ws.id, buttonElement);
                                }
                              }}
                              className="p-0.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-border text-text-tertiary hover:text-text-primary transition"
                              aria-label="Options de l'espace"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </div>
                        )}

                        {/* Accordion trigger */}
                        <button
                          onClick={(e) => toggleAccordion(ws.id, e)}
                          className="p-0.5 rounded-sm text-text-tertiary hover:text-text-primary transition"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Accordion Dropdown Content */}
                  {isOpen && !isCollapsed && (
                    <div className="pl-2 pr-1 py-0 border-l border-border/60 ml-4 mt-0 mb-0.5 animate-in slide-in-from-top-1 duration-150 max-h-72 overflow-y-auto">
                      {hasForms ? (
                        <>
                          {displayedForms.map((form) => (
                            <div key={form.id} className="group relative">
                              <div className="flex items-center justify-between w-full">
                                {editingFormId === form.id ? (
                                  <form
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      handleRenameFormSubmit(form.id);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex-1 px-3"
                                  >
                                    <input
                                      type="text"
                                      value={editFormTitle}
                                      onChange={(e) => setEditFormTitle(e.target.value)}
                                      onBlur={() => {
                                        handleRenameFormSubmit(form.id);
                                      }}
                                      className="w-full px-1 py-0.5 border border-border bg-bg-surface rounded-sm text-xs font-normal focus:outline-hidden focus:border-accent text-text-primary"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === 'Escape') setEditingFormId(null);
                                      }}
                                    />
                                  </form>
                                ) : (
                                  <Link
                                    href={formHref(form)}
                                    style={{ height: 'clamp(24px, 1.8vw, 28px)', fontSize: 'var(--sidebar-text-sm)' }}
                                    className={cn(
                                      'flex items-center gap-2 px-1 text-text-secondary hover:text-text-primary rounded-sm hover:bg-bg-elevated transition truncate flex-1',
                                      pathname === formHref(form) && 'text-text-primary font-medium'
                                    )}
                                  >
                                    <FileText
                                      style={{ width: 'var(--sidebar-icon)', height: 'var(--sidebar-icon)' }}
                                      className="shrink-0 text-text-tertiary"
                                    />
                                    <span className={cn("truncate transition-all duration-200", isCollapsed && "hidden")}>
                                      {form.title || 'Formulaire sans titre'}
                                    </span>
                                  </Link>
                                )}

                                {/* Bouton menu contextuel */}
                                <button
                                  ref={(el) => {
                                    formMenuButtonRefs.current[form.id] = el;
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    const buttonElement = e.currentTarget;
                                    if (activeFormMenuId === form.id) {
                                      handleCloseFormMenu();
                                    } else {
                                      handleOpenFormMenu(form.id, buttonElement);
                                    }
                                  }}
                                  className="p-2 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-border text-text-tertiary hover:text-text-primary transition"
                                  aria-label="Options du formulaire"
                                >
                                  <MoreHorizontal className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                          {hasMoreForms && (
                            <Link
                              href={`/workspaces/${ws.id}`}
                              className="block px-3 text-sm text-accent hover:underline font-medium flex items-center"
                              style={{ height: 'clamp(24px, 1.8vw, 28px)' }}
                            >
                              Voir tous ({forms.length}) →
                            </Link>
                          )}
                        </>
                      ) : (
                        <span className="block px-1 py-1 text-sm text-text-tertiary">
                          Aucun formulaire
                        </span>
                      )}

                      {/* Bouton + Nouveau formulaire */}
                      <button
                        onClick={() => handleCreateProjectInWorkspace(ws.id)}
                        style={{ height: 'clamp(24px, 1.8vw, 28px)', fontSize: 'var(--sidebar-text-sm)' }}
                        className="flex items-center gap-2 px-1 text-mooove-cyan hover:bg-papyrus-border/20 rounded-md transition w-full text-left font-medium mt-0"
                      >
                        <Plus
                          style={{ width: 'var(--sidebar-icon)', height: 'var(--sidebar-icon)' }}
                          className="shrink-0"
                        />
                        <span className={cn("truncate transition-all duration-200", isCollapsed && "hidden")}>
                          Nouveau projet
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Inline Workspace Creation Input */}
        <div className="pt-1">
          {isCreating ? (
            <form onSubmit={handleCreateWorkspace} className="px-2 py-1 flex items-center gap-1">
              <input
                type="text"
                required
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="Nom du workspace..."
                className="flex-1 h-8 px-2 text-xs border border-border bg-bg-surface rounded-md focus:border-accent focus:outline-hidden"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setIsCreating(false); setNewWorkspaceName(''); }
                }}
              />
              <button
                type="submit"
                className="p-1 rounded-sm text-green-600 hover:bg-bg-elevated transition shrink-0"
                aria-label="Confirmer"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => { setIsCreating(false); setNewWorkspaceName(''); }}
                className="p-1 rounded-sm text-text-tertiary hover:bg-bg-elevated hover:text-text-primary transition shrink-0"
                aria-label="Annuler"
              >
                <X className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <button
              onClick={() => setIsCreating(true)}
              style={{ fontSize: 'var(--sidebar-text-sm)' }}
              className={cn(
                "flex items-center w-full text-text-tertiary hover:text-text-primary transition font-medium px-3 py-2",
                isCollapsed ? "justify-center" : "text-left gap-2"
              )}
            >
              <Plus
                style={{ width: 'var(--sidebar-icon)', height: 'var(--sidebar-icon)' }}
              />
              <span className={cn("truncate transition-all duration-200", isCollapsed && "hidden")}>
                Nouveau workspace
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Static Sub-Navigation */}
      <div className="px-2 py-1 border-t border-border">
        {STATIC_NAV.map(({ href, label, icon: Icon, badge }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              style={{ height: 'var(--sidebar-item-height)', fontSize: 'var(--sidebar-text-base)' }}
              className={cn(
                'mb-0.5 flex items-center rounded-md px-3 font-medium transition',
                active
                  ? 'bg-bg-elevated text-text-primary'
                  : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary',
                isCollapsed ? 'justify-center' : 'justify-between gap-2'
              )}
            >
              <div className="flex items-center gap-2">
                <Icon
                  style={{ width: 'var(--sidebar-icon)', height: 'var(--sidebar-icon)' }}
                  className="text-text-tertiary"
                />
                <span className={cn("truncate transition-all duration-200", isCollapsed && "hidden")}>
                  {label}
                </span>
              </div>
              {badge && !isCollapsed && (
                <span className="bg-bg-elevated border border-border text-text-secondary text-xs font-semibold px-2 py-0.5 rounded-full select-none">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Circle User Profile bottom */}
      <div className="border-t border-border px-3 py-2 bg-bg-elevated/20">
        <div className={cn("flex items-center", isCollapsed ? "justify-center" : "justify-between")}>
          <div className={cn("flex items-center min-w-0", isCollapsed ? "justify-center" : "gap-2")}>
            {/* Initial circle */}
            <div
              style={{
                width: 'var(--sidebar-avatar-size)',
                height: 'var(--sidebar-avatar-size)',
                minWidth: 'var(--sidebar-avatar-size)',
                fontSize: 'var(--sidebar-text-base)'
              }}
              className="flex items-center justify-center rounded-full bg-mooove-navy text-mooove-ice font-bold font-display"
            >
              {(userEmail || currentUser?.email || 'U').charAt(0).toUpperCase()}
            </div>
            {/* Info text */}
            <div className="flex flex-col leading-tight truncate">
              <span
                style={{ fontSize: 'var(--sidebar-text-sm)' }}
                className={cn("font-display font-medium text-text-primary truncate transition-all duration-200", isCollapsed && "hidden")}
              >
                {userEmail || currentUser?.email || 'Utilisateur'}
              </span>
            </div>
          </div>

          {!isCollapsed && (
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md hover:bg-bg-elevated text-text-tertiary hover:text-danger transition shrink-0"
              title="Déconnexion"
            >
              <LogOut className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal for Workspaces */}
      {deletingWorkspace && typeof window !== 'undefined' && createPortal(
        <Modal
          isOpen={!!deletingWorkspace}
          onClose={() => setDeletingWorkspace(null)}
          title="Supprimer le workspace"
        >
          <div className="space-y-4">
            <p>
              Êtes-vous sûr de vouloir supprimer définitivement le workspace{' '}
              <strong className="text-text-primary">« {deletingWorkspace.name} »</strong> ?
            </p>
            <p className="text-xs text-text-tertiary font-medium">
              Cette action est irréversible. Tous les formulaires associés à ce workspace seront dissociés (replacés hors workspace).
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeletingWorkspace(null)}
              >
                Annuler
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDeleteWorkspaceConfirm}
              >
                Supprimer le workspace
              </Button>
            </div>
          </div>
        </Modal>,
        document.body
      )}

      {/* Dropdown menu des formulaires rendu dans un portail */}
      {activeFormMenuId && (
        <FormDropdownMenu
          formId={activeFormMenuId}
          onClose={handleCloseFormMenu}
        />
      )}

      {/* Dropdown menu des workspaces rendu dans un portail */}
      {activeMenuId && workspaces.find(w => w.id === activeMenuId) && (
        <WorkspaceDropdownMenu
          ws={workspaces.find(w => w.id === activeMenuId)!}
          onClose={handleCloseWorkspaceMenu}
        />
      )}

      {/* Modal de Gestion des Membres du Workspace */}
      {managingWorkspace && typeof window !== 'undefined' && createPortal(
        <Modal
          isOpen={!!managingWorkspace}
          onClose={() => setManagingWorkspace(null)}
          title={`Gérer les membres — ${managingWorkspace.name}`}
        >
          <div className="space-y-6">
            {/* Lien de partage direct */}
            <div className="space-y-3">
              <span className="block text-xs font-semibold uppercase tracking-[0.8px] text-text-tertiary">
                Lien de partage
              </span>
              <div className="flex items-center gap-2 p-3 bg-bg-elevated rounded-md border border-border">
                <input
                  type="text"
                  readOnly
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}/workspaces/${managingWorkspace?.id}`}
                  className="flex-1 text-sm text-text-secondary bg-transparent border-none outline-hidden cursor-text select-all"
                  onClick={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (managingWorkspace) {
                      const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/workspaces/${managingWorkspace.id}`;
                      copyToClipboard(url);
                      toast.success('Lien copié !');
                    }
                  }}
                >
                  Copier
                </Button>
              </div>
            </div>

            {/* Formulaire d'invitation */}
            <form onSubmit={handleAddMember} className="space-y-3">
              <span className="block text-xs font-semibold uppercase tracking-[0.8px] text-text-tertiary">
                Inviter un membre par email
              </span>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    placeholder="collaborateur@mooove.live"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    className="flex-1 h-10 px-3 border border-border bg-bg-surface text-sm rounded-md focus:border-accent focus:outline-hidden"
                  />
                  <Button type="submit" variant="cta" loading={memberLoading} size="sm">
                    Inviter
                  </Button>
                </div>

                {/* Option d'envoi d'email */}
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendEmailInvite}
                    onChange={(e) => setSendEmailInvite(e.target.checked)}
                    className="w-4 h-4 text-accent border-border rounded-sm focus:ring-accent focus:ring-2"
                  />
                  <span className="text-text-secondary">
                    Envoyer un email d'invitation avec le lien de l'espace de travail
                  </span>
                </label>
              </div>
            </form>

            {/* Liste des membres */}
            <div className="space-y-3">
              <span className="block text-xs font-semibold uppercase tracking-[0.8px] text-text-tertiary">
                Membres de l'espace ({workspaceMembers.length})
              </span>
              <div className="border border-border rounded-lg bg-bg-surface/50 divide-y divide-border overflow-hidden max-h-56 overflow-y-auto">
                {workspaceMembers.length === 0 ? (
                  <span className="block p-4 text-sm text-text-tertiary text-center">
                    Chargement des membres...
                  </span>
                ) : (
                  workspaceMembers.map((member) => (
                    <div key={member.user_id} className="flex items-center justify-between p-3.5">
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium text-text-primary truncate">
                          {member.email}
                        </span>
                        <span className="text-xs text-text-tertiary uppercase font-semibold">
                          {member.role}
                        </span>
                      </div>
                      
                      {/* Bouton de retrait (pas pour le créateur ou si local-user) */}
                      {member.user_id !== currentUser?.id && member.user_id !== 'local-user' && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member.user_id, member.email)}
                          className="text-xs text-danger hover:underline font-semibold"
                        >
                          Retirer
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Note sur la collaboration */}
            <div className="p-3 bg-accent/5 border border-accent/20 rounded-lg">
              <p className="text-xs text-text-secondary">
                <strong>Note :</strong> La collaboration en temps réel n'est pas encore implémentée.
                Si plusieurs personnes modifient le même formulaire simultanément, la dernière sauvegarde écrasera les modifications précédentes.
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-border/60">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setManagingWorkspace(null)}
              >
                Fermer
              </Button>
            </div>
          </div>
        </Modal>,
        document.body
      )}

      {/* Dialog de confirmation de suppression de formulaire */}
      {typeof window !== 'undefined' && createPortal(
        <ConfirmDialog
          isOpen={!!deletingFormId}
          onClose={() => setDeletingFormId(null)}
          onConfirm={confirmDeleteForm}
          title="Supprimer ce formulaire ?"
          message={`« ${findFormById(deletingFormId ?? '') ?.title ?? 'Ce formulaire'} » sera supprimé définitivement. Cette action est irréversible.`}
          confirmLabel="Supprimer"
        />,
        document.body
      )}

      {/* Modal de Confirmation de Suppression de Membre */}
      {memberToRemove && typeof window !== 'undefined' && createPortal(
        <ConfirmationModal
          isOpen={!!memberToRemove}
          onClose={() => setMemberToRemove(null)}
          onConfirm={confirmRemoveMember}
          title="Retirer ce membre ?"
          message={`Êtes-vous sûr de vouloir retirer ${memberToRemove?.email} de cet espace de travail ? Cette action est irréversible.`}
          confirmText="Retirer"
          cancelText="Annuler"
          loading={removeLoading}
          variant="danger"
        />,
        document.body
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
            <p className="text-sm text-text-secondary">
              Choisissez l'espace de travail cible pour déplacer ce formulaire :
            </p>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {workspaces.map((ws) => {
                const form = movingFormId ? findFormById(movingFormId) : null;
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
                    <span className="font-medium">{ws.name}</span>
                    {isCurrent && <span className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded-full">Actuel</span>}
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
    </aside>
  );
}
