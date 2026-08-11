'use client';

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Pencil, Plus, Search, Send, SquareSlash, Trash2, User, Users, X, MoreHorizontal, Copy, Edit2, Upload, Share2, FolderInput, Download, Sparkles, ExternalLink, Clock } from 'lucide-react';
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

const AI_PROMPT_TEMPLATE = `Tu es un expert en structure de données pour formulaires Papyrus.
Je vais te donner un brouillon de formulaire (rédigé sur Word, Docs ou format texte).
Ta tâche est de le transformer en un objet JSON valide et compatible avec mon application de formulaires "Papyrus".

Voici la structure JSON stricte à respecter :
{
  "title": "Titre du formulaire",
  "description": "Description du formulaire",
  "display_mode": "sections",
  "scoring_enabled": true, // Mettre à true si le formulaire contient des questions notées (avec des points pour les réponses)
  "show_score_to_respondent": false, // Toujours false
  "fields": [
    {
      "id": "generer_un_id_temporaire_unique_1",
      "type": "single_choice", // 'short_text', 'long_text', 'email', 'phone', 'number', 'url', 'single_choice', 'multiple_choice', 'dropdown', 'rating', 'nps', 'date', 'file', 'section_break', 'statement', 'image', 'video', 'matrix'
      "label": {
        "fr": "Libellé de la question en français"
      },
      "description": {
        "fr": "Description ou aide optionnelle en français"
      },
      "placeholder": {
        "fr": "Texte d'exemple optionnel"
      },
      "required": false,
      "options": [
        {
          "id": "opt_1",
          "label": {
            "fr": "Option 1"
          },
          "points": 5 // Optionnel: Nombre de points positif ou négatif (ex: 10, -5, etc.) si notation
        }
      ]
    }
  ],
  "logic_rules": [
    // Renseigne ici les conditions de redirection (branchements) si indiquées dans le brouillon
    {
      "id": "rule_1",
      "conditions": [
        {
          "source_field_id": "id_de_la_question_source",
          "operator": "equals", // ou 'not_equals', 'contains', 'greater_than', 'less_than'
          "value": "id_de_l_option_selectionnee"
        }
      ],
      "conditions_operator": "AND",
      "action_type": "show_field", // ou 'hide_field', 'jump_to', 'end_form'
      "target_field_id": "id_de_la_question_cible",
      "rule_order": 0
    }
  ]
}

Consignes importantes :
1. Les champs textuels 'label', 'description' et 'placeholder' doivent être des objets avec la clé "fr" (ex: "label": {"fr": "Nom"}).
2. Les types de champs autorisés sont uniquement : 'short_text', 'long_text', 'email', 'phone', 'number', 'url', 'single_choice', 'multiple_choice', 'dropdown', 'rating', 'nps', 'date', 'file', 'section_break', 'statement', 'image', 'video', 'matrix'.
3. Si le brouillon indique des règles de logique (ex: "si Oui, afficher Q9") ou de notation (ex: "Oui = +10 pts"), intègre-les de manière rigoureuse dans les propriétés "points" et le tableau "logic_rules" en veillant à la correspondance des IDs.
4. Génère uniquement le code JSON brut, sans introduction ni conclusion.

Voici mon brouillon de formulaire à convertir :
[COLLE TON BROUILLON ICI]`;


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
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiJsonInput, setAiJsonInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiModalTab, setAiModalTab] = useState<'file' | 'text'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  // Nouveaux états pour le compromis IA
  const [aiMethod, setAiMethod] = useState<'site' | 'my-ia'>('site');
  const [myIaJsonInput, setMyIaJsonInput] = useState('');
  const [isImportingMyIa, setIsImportingMyIa] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

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

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setFileError(null);

    const filename = file.name.toLowerCase();
    if (filename.endsWith('.txt') || filename.endsWith('.md') || file.type.startsWith('text/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = (event.target?.result as string) || '';
        if (text.length > 3000) {
          setFileError(`Ce fichier est trop long (${text.length} caractères). La limite pour l'IA gratuite du site est de 3000 caractères. Veuillez utiliser l'option "Créer à partir de mon IA".`);
        }
      };
      reader.readAsText(file);
    } else {
      if (file.size > 150 * 1024) {
        setFileError(`Ce fichier est trop volumineux (${(file.size / 1024).toFixed(0)} Ko). L'IA gratuite du site est limitée aux petits fichiers. Veuillez utiliser l'option "Créer à partir de mon IA".`);
      }
    }
  };

  const handleMethodChange = (method: 'site' | 'my-ia') => {
    setAiMethod(method);
    setFileError(null);
    setSelectedFile(null);
    setAiJsonInput('');
    setMyIaJsonInput('');
  };

  const handleTabChange = (tab: 'file' | 'text') => {
    setAiModalTab(tab);
    setFileError(null);
    setSelectedFile(null);
    setAiJsonInput('');
  };

  const handleGenerateForm = async () => {
    setIsGenerating(true);
    try {
      const formData = new FormData();
      if (aiModalTab === 'file') {
        if (!selectedFile) {
          throw new Error('Veuillez sélectionner un fichier');
        }
        if (fileError) {
          throw new Error(fileError);
        }
        formData.append('file', selectedFile);
      } else {
        if (!aiJsonInput.trim()) {
          throw new Error('Veuillez coller un brouillon textuel');
        }
        if (aiJsonInput.length > 3000) {
          throw new Error(`Votre texte est trop long (${aiJsonInput.length} caractères). La limite pour l'IA gratuite du site est de 3000 caractères. Veuillez utiliser l'option "Créer à partir de mon IA" ou raccourcir le texte.`);
        }
        formData.append('draft', aiJsonInput);
      }

      const res = await fetch('/api/generate-form', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Erreur lors de la génération avec l\'IA');
      }

      const parsed = await res.json();

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Le contenu JSON généré par l\'IA est invalide');
      }
      if (!parsed.title) {
        throw new Error('Le formulaire JSON généré doit contenir un titre (title)');
      }

      const targetWorkspaceId = await resolveTargetWorkspaceId();
      const newForm = await importForm(parsed, targetWorkspaceId || undefined);
      toast.success('Formulaire généré par l\'IA avec succès !');
      setIsAiModalOpen(false);
      setAiJsonInput('');
      setSelectedFile(null);
      router.push(`/forms/${newForm.id}/edit`);
    } catch (err: any) {
      console.error('Failed to generate form from AI:', err);
      toast.error(`Erreur de génération : ${err.message || 'Une erreur inconnue est survenue'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImportMyIaJSON = async () => {
    if (!myIaJsonInput.trim()) {
      toast.error('Veuillez coller le JSON généré par votre IA');
      return;
    }
    setIsImportingMyIa(true);
    try {
      const cleaned = cleanJsonString(myIaJsonInput);
      const parsed = JSON.parse(cleaned);
      
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Le format JSON est invalide');
      }
      if (!parsed.title) {
        throw new Error('Le JSON doit contenir un titre (title)');
      }

      const targetWorkspaceId = await resolveTargetWorkspaceId();
      const newForm = await importForm(parsed, targetWorkspaceId || undefined);
      toast.success('Formulaire importé avec succès !');
      setIsAiModalOpen(false);
      setMyIaJsonInput('');
      setAiJsonInput('');
      setSelectedFile(null);
      router.push(`/forms/${newForm.id}/edit`);
    } catch (err: any) {
      console.error('Failed to import manual AI JSON:', err);
      toast.error(`Erreur d'importation : ${err.message || 'Le JSON fourni est invalide.'}`);
    } finally {
      setIsImportingMyIa(false);
    }
  };

  const handleCopyPrompt = async () => {
    const textToAnalyze = aiJsonInput.trim() || "(Collez votre texte de brouillon ici ou décrivez votre besoin)";
    const fullPrompt = AI_PROMPT_TEMPLATE.replace('[COLLE TON BROUILLON ICI]', textToAnalyze);
    await copyToClipboard(fullPrompt);
    setCopiedPrompt(true);
    toast.success('Instructions (Prompt) copiées !');
    setTimeout(() => setCopiedPrompt(false), 3000);
  };

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
          <button
            onClick={() => setIsAiModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-bg-surface px-2.5 py-1.5 text-xs font-medium text-text-primary transition hover:bg-bg-elevated hover:border-accent"
          >
            <Sparkles className="h-3.5 w-3.5 text-yellow-500" />
            Importer depuis un brouillon
          </button>
          <button
            onClick={handleImportClick}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-xs font-medium text-text-primary transition hover:bg-bg-elevated hover:border-border-strong"
          >
            <Upload className="h-3.5 w-3.5" />
            Importer (JSON)
          </button>
          <button
            onClick={handleNew}
            className="inline-flex items-center gap-1.5 rounded-md border border-mooove-cyan bg-mooove-cyan px-2.5 py-1.5 text-xs font-medium text-black transition hover:bg-mooove-cyan/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Nouveau formulaire
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
                      'inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm transition',
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

      {/* Modal d'importation IA */}
      {isAiModalOpen && typeof window !== 'undefined' && createPortal(
        <Modal
          isOpen={isAiModalOpen}
          onClose={() => {
            if (!isGenerating && !isImportingMyIa) {
              setIsAiModalOpen(false);
              setAiJsonInput('');
              setSelectedFile(null);
              setMyIaJsonInput('');
              setAiMethod('site');
              setFileError(null);
            }
          }}
          title="Importer depuis un brouillon"
          size="md"
        >
          <div className="space-y-4 font-body">
            {/* Méthode de génération principale */}
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg-elevated p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => handleMethodChange('site')}
                disabled={isGenerating || isImportingMyIa}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded py-2 transition",
                  aiMethod === 'site'
                    ? "bg-bg-surface text-text-primary shadow"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <Sparkles className="h-3.5 w-3.5 text-yellow-500" />
                Créer avec l'IA du site
              </button>
              <button
                type="button"
                onClick={() => handleMethodChange('my-ia')}
                disabled={isGenerating || isImportingMyIa}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded py-2 transition",
                  aiMethod === 'my-ia'
                    ? "bg-bg-surface text-text-primary shadow"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <FolderInput className="h-3.5 w-3.5 text-mooove-cyan" />
                Créer à partir de mon IA
              </button>
            </div>

            {aiMethod === 'site' ? (
              <div className="space-y-4">
                <p className="text-xs text-text-secondary">
                  Pour les <strong>petits fichiers</strong> (max 3000 caractères). L'IA intégrée analyse votre document pour structurer les questions, les scores et la logique automatiquement.
                </p>

                {/* Sous-onglets Fichier/Texte */}
                <div className="flex gap-2 border-b border-border pb-px text-sm">
                  <button
                    type="button"
                    onClick={() => handleTabChange('file')}
                    disabled={isGenerating}
                    className={cn(
                      "pb-2 font-medium transition border-b-2 px-1",
                      aiModalTab === 'file'
                        ? "border-accent text-text-primary"
                        : "border-transparent text-text-tertiary hover:text-text-secondary"
                    )}
                  >
                    Importer un fichier
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTabChange('text')}
                    disabled={isGenerating}
                    className={cn(
                      "pb-2 font-medium transition border-b-2 px-1",
                      aiModalTab === 'text'
                        ? "border-accent text-text-primary"
                        : "border-transparent text-text-tertiary hover:text-text-secondary"
                    )}
                  >
                    Coller du texte
                  </button>
                </div>

                {aiModalTab === 'file' ? (
                  <div className="space-y-3">
                    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-6 text-center hover:border-border-strong transition">
                      <Upload className="h-8 w-8 text-text-tertiary mb-2" />
                      <label className="cursor-pointer text-xs font-semibold text-accent hover:underline">
                        <span>Sélectionner un fichier</span>
                        <input
                          type="file"
                          accept=".pdf,.docx,.txt,.md"
                          disabled={isGenerating}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileSelect(file);
                          }}
                          className="hidden"
                        />
                      </label>
                      <p className="text-[10px] text-text-tertiary mt-1">
                        Formats acceptés : PDF, Word (.docx), TXT, MD (Max 150Ko)
                      </p>
                    </div>

                    {fileError && (
                      <div className="rounded-md bg-red-500/10 border border-red-500/30 p-2.5 text-xs text-red-600 dark:text-red-400">
                        ⚠️ {fileError}
                      </div>
                    )}

                    {selectedFile && (
                      <div className="flex items-center gap-2 rounded-md bg-bg-elevated/40 border border-border p-2.5 text-xs text-text-primary">
                        <FileText className="h-4 w-4 text-accent" />
                        <span className="truncate flex-1 font-medium">{selectedFile.name}</span>
                        <span className="text-text-tertiary">({(selectedFile.size / 1024).toFixed(0)} Ko)</span>
                        <button
                          type="button"
                          disabled={isGenerating}
                          onClick={() => {
                            setSelectedFile(null);
                            setFileError(null);
                          }}
                          className="text-text-tertiary hover:text-danger ml-2"
                        >
                          Supprimer
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={aiJsonInput}
                      onChange={(e) => setAiJsonInput(e.target.value)}
                      disabled={isGenerating}
                      placeholder="Exemple : 
Q1 - Êtes-vous satisfait ? (Oui/Non)
- Oui (+5 points)
- Non (0 point) -> redirige vers Q2
Q2 - Pourquoi ? (texte libre)
..."
                      className="h-48 w-full rounded-md border border-border bg-bg-surface p-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none disabled:opacity-50"
                    />
                    <div className="flex justify-between items-center text-[10px] text-text-tertiary">
                      <span>Caractères : {aiJsonInput.length} / 3000 max</span>
                      {aiJsonInput.length > 3000 && (
                        <span className="text-danger font-semibold">Brouillon trop long pour l'IA du site. Veuillez utiliser "Créer à partir de mon IA".</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isGenerating}
                    onClick={() => {
                      setIsAiModalOpen(false);
                      setAiJsonInput('');
                      setSelectedFile(null);
                      setMyIaJsonInput('');
                      setAiMethod('site');
                      setFileError(null);
                    }}
                  >
                    Annuler
                  </Button>
                  <Button
                    variant="cta"
                    size="sm"
                    loading={isGenerating}
                    disabled={
                      isGenerating ||
                      (aiModalTab === 'file' && (!selectedFile || !!fileError)) ||
                      (aiModalTab === 'text' && (!aiJsonInput.trim() || aiJsonInput.length > 3000))
                    }
                    onClick={handleGenerateForm}
                  >
                    Générer le formulaire
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-md bg-accent/5 border border-accent/20 p-3 text-xs text-text-secondary leading-relaxed">
                  Copiez le prompt ci-dessous pour votre IA (ChatGPT, Claude, etc.), puis collez le code JSON obtenu dans la zone ci-dessous.
                </div>

                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCopyPrompt}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-md px-6 py-2.5 text-xs font-semibold shadow-sm transition-all border w-full justify-center max-w-[280px]",
                      copiedPrompt
                        ? "bg-green-500/10 border-green-500 text-green-600 dark:text-green-400"
                        : "bg-mooove-cyan/10 border-mooove-cyan/30 text-mooove-cyan hover:bg-mooove-cyan/20"
                    )}
                  >
                    <Sparkles className="h-4 w-4" />
                    {copiedPrompt ? "Prompt copié !" : "Copier le prompt"}
                  </button>

                  <div className="grid grid-cols-3 gap-2 w-full">
                    <a
                      href="https://chatgpt.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-bg-surface px-2.5 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition shadow-sm text-center"
                    >
                      ChatGPT
                      <ExternalLink className="h-3 w-3" />
                    </a>

                    <a
                      href="https://claude.ai"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-bg-surface px-2.5 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition shadow-sm text-center"
                    >
                      Claude
                      <ExternalLink className="h-3 w-3" />
                    </a>

                    <a
                      href="https://gemini.google.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-bg-surface px-2.5 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition shadow-sm text-center"
                    >
                      Gemini
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-text-secondary">
                    Collez le code JSON généré par votre IA :
                  </label>
                  <textarea
                    value={myIaJsonInput}
                    onChange={(e) => setMyIaJsonInput(e.target.value)}
                    disabled={isImportingMyIa}
                    placeholder='Exemple : 
{
  "title": "Mon formulaire",
  "fields": [
    ...
  ]
}'
                    className="h-48 w-full font-mono rounded-md border border-border bg-bg-surface p-3 text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none disabled:opacity-50"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isImportingMyIa}
                    onClick={() => {
                      setIsAiModalOpen(false);
                      setMyIaJsonInput('');
                      setAiJsonInput('');
                      setSelectedFile(null);
                      setAiMethod('site');
                      setFileError(null);
                    }}
                  >
                    Annuler
                  </Button>
                  <Button
                    variant="cta"
                    size="sm"
                    loading={isImportingMyIa}
                    disabled={isImportingMyIa || !myIaJsonInput.trim()}
                    onClick={handleImportMyIaJSON}
                  >
                    <FolderInput className="h-3.5 w-3.5 mr-1" />
                    Importer le JSON
                  </Button>
                </div>
              </div>
            )}
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
        className="h-9 w-full rounded-md border border-border bg-bg-surface pl-8 pr-8 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Effacer la recherche"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-tertiary transition hover:bg-bg-elevated hover:text-text-primary"
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
                      className="h-8 w-full rounded-md border border-border-strong bg-bg-surface px-2.5 text-sm focus:border-accent focus:outline-none"
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
                    className="p-1 rounded text-text-tertiary hover:bg-bg-elevated hover:text-text-primary transition"
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
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded"
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
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded"
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
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded"
            >
              <Share2 className="h-4 w-4 text-text-tertiary" />
              Copier le lien de partage
            </button>
             <button
              onClick={() => {
                onMoveForm(activeMenuId);
                setActiveMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded"
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
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded"
            >
              <Clock className="h-4 w-4 text-text-tertiary" />
              Date de clôture
            </button>
            <button
              onClick={() => {
                onDuplicate(activeMenuId);
                setActiveMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded"
            >
              <Copy className="h-4 w-4 text-text-tertiary" />
              Dupliquer
            </button>
            <button
              onClick={() => {
                handleExportJson(activeMenuId);
                setActiveMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition rounded"
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
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger/5 transition font-semibold rounded"
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
