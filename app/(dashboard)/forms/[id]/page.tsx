'use client';

import { useMemo, useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  Clock,
  Copy,
  Edit3,
  FolderOpen,
  LayoutTemplate,
  Link2,
  ListChecks,
  MoreHorizontal,
  Plug,
  Settings,
  Share2
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useForm } from '@/lib/store/use-forms';
import {
  archiveForm,
  cloneForm,
  deleteForm,
  setAsTemplate,
  unarchiveForm,
  updateForm
} from '@/lib/store';
import { cn, getBaseUrl } from '@/lib/utils';
import type { Form } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { toast } from '@/components/ui/Toast';
import { ClosingDateModal } from '@/components/dashboard/ClosingDateModal';
import { FormShareTab } from '@/components/dashboard/FormShareTab';
import { FormIntegrationsTab } from '@/components/dashboard/FormIntegrationsTab';
import { FormSettingsTab } from '@/components/dashboard/FormSettingsTab';
import { FormStatsRow } from '@/components/dashboard/FormStatsRow';
import { FormInsightsTab } from '@/components/dashboard/FormInsightsTab';
import { FormRecordsTab } from '@/components/dashboard/FormRecordsTab';

type Tab = 'overview' | 'responses' | 'share' | 'integrations' | 'settings';

const TABS: Tab[] = ['overview', 'responses', 'share', 'integrations', 'settings'];

function FormDashboardContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { form, loading } = useForm(params.id);
  const [tab, setTab] = useState<Tab>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showClosingDateModal, setShowClosingDateModal] = useState(false);

  // Réponses soumises partagées entre les onglets
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(true);

  /**
   * Les ébauches ne sont pas des réponses : elles ne comptent ni dans les
   * statistiques ni dans les graphiques, sans quoi un formulaire simplement
   * ouvert et abandonné gonflerait tous les chiffres. Seul l'onglet Réponses
   * peut les afficher, sur demande explicite.
   */
  const completedSubmissions = useMemo(
    () => submissions.filter((submission) => !submission.is_partial),
    [submissions]
  );

  // Charger toutes les réponses depuis Supabase
  useEffect(() => {
    async function fetchSubmissions() {
      if (!form) return;
      const supabase = createClient();
      try {
        const { data, error } = await supabase
          .from('submissions')
          .select('*')
          .eq('form_id', form.id)
          .order('completed_at', { ascending: false });

        if (error) throw error;
        setSubmissions(data || []);
      } catch (err) {
        console.error('Failed to fetch submissions:', err);
      } finally {
        setSubmissionsLoading(false);
      }
    }
    fetchSubmissions();
  }, [form?.id]);

  // Nom de l'espace de travail auquel appartient le formulaire.
  useEffect(() => {
    const teamId = form?.team_id;
    if (!teamId) return;

    let cancelled = false;

    fetch('/api/teams')
      .then((response) => (response.ok ? response.json() : []))
      .then((teams: { id: string; name: string }[]) => {
        if (cancelled) return;
        const workspace = teams.find((team) => team.id === teamId);
        if (workspace) setWorkspaceName(workspace.name);
      })
      .catch((err) => console.error(err));

    return () => {
      cancelled = true;
    };
  }, [form?.team_id]);

  useEffect(() => {
    const activeTab = searchParams.get('tab') as Tab;
    if (activeTab && TABS.includes(activeTab)) {
      setTab(activeTab);
    }
  }, [searchParams]);

  if (loading) return null;

  if (!form) {
    return (
      <div className="mx-auto max-w-2xl py-20 text-center">
        <h1 className="font-display text-2xl">Formulaire introuvable</h1>
        <p className="papyrus-meta mt-2 text-sm not-italic">i. Ce Papyrus n&apos;existe pas (ou plus)</p>
        <Link href="/forms" className="mt-6 inline-block">
          <Button variant="secondary">← Retour à la liste</Button>
        </Link>
      </div>
    );
  }

  async function handleClone() {
    if (!form) return;
    const cloned = await cloneForm(form.id);
    if (cloned) router.push(`/forms/${cloned.id}/edit`);
  }

  function handleArchiveToggle() {
    if (!form) return;
    if (form.status === 'closed') unarchiveForm(form.id);
    else archiveForm(form.id);
    setMenuOpen(false);
  }

  function handleToggleTemplate() {
    if (!form) return;
    setAsTemplate(form.id, !form.is_template, 'personal');
    setMenuOpen(false);
  }

  function handleDelete() {
    if (!form) return;
    setShowDeleteConfirm(true);
  }

  async function executeDelete() {
    if (!form) return;
    setShowDeleteConfirm(false);
    try {
      await deleteForm(form.id);
      router.push('/forms');
    } catch (error) {
      console.error('Failed to delete form:', error);
      toast.error('Impossible de supprimer le formulaire. Veuillez réessayer.');
    }
  }

  async function handleCopyLink() {
    const baseUrl = getBaseUrl();
    const publicUrl = `${baseUrl}/f/${form!.slug}`;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success('Lien copié !');
    } catch {
      toast.error(`Copiez manuellement : ${publicUrl}`);
    }
    setMenuOpen(false);
  }

  function handleMove() {
    toast.info('Déplacer vers un espace de travail — bientôt disponible');
    setMenuOpen(false);
  }

  async function handleSaveClosingDate(closesAt: string | null) {
    if (!form) return;
    try {
      await updateForm(form.id, { closes_at: closesAt });
      toast.success('Date de clôture mise à jour');
    } catch (error) {
      console.error('Failed to update closing date:', error);
      toast.error('Erreur lors de la mise à jour de la date de clôture');
      throw error;
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Header */}
      <Header
        form={form}
        workspaceName={workspaceName}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        onClone={handleClone}
        onArchiveToggle={handleArchiveToggle}
        onToggleTemplate={handleToggleTemplate}
        onDelete={handleDelete}
        onCopyLink={handleCopyLink}
        onMove={handleMove}
        onEditClosingDate={() => setShowClosingDateModal(true)}
      />

      {/* Stats — avec les vraies réponses du formulaire */}
      <FormStatsRow submissions={completedSubmissions} loading={submissionsLoading} />

      {/* Onglets */}
      <div className="border-b border-border">
        <div className="flex gap-1">
          <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={BarChart3}>
            Vue d&apos;ensemble
          </TabButton>
          <TabButton active={tab === 'responses'} onClick={() => setTab('responses')} icon={ListChecks}>
            Réponses
          </TabButton>
          <TabButton active={tab === 'share'} onClick={() => setTab('share')} icon={Share2}>
            Partage
          </TabButton>
          <TabButton
            active={tab === 'integrations'}
            onClick={() => setTab('integrations')}
            icon={Plug}
          >
            Intégrations
          </TabButton>
          <TabButton active={tab === 'settings'} onClick={() => setTab('settings')} icon={Settings}>
            Paramètres
          </TabButton>
        </div>
      </div>

      {/* Contenu de l'onglet */}
      {tab === 'overview' && (
        <FormInsightsTab
          form={form}
          submissions={completedSubmissions}
          loading={submissionsLoading}
        />
      )}
      {tab === 'responses' && (
        <FormRecordsTab 
          form={form} 
          submissions={submissions} 
          setSubmissions={setSubmissions} 
          loading={submissionsLoading} 
        />
      )}
      {tab === 'share' && <FormShareTab form={form} />}
      {tab === 'integrations' && <FormIntegrationsTab form={form} />}
      {tab === 'settings' && <FormSettingsTab form={form} />}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={executeDelete}
        title="Supprimer ce formulaire ?"
        message={`« ${form.title} » sera supprimé définitivement. Cette action est irréversible.`}
        confirmLabel="Supprimer"
      />

      <ClosingDateModal
        isOpen={showClosingDateModal}
        onClose={() => setShowClosingDateModal(false)}
        initialClosesAt={form.closes_at || null}
        onSave={handleSaveClosingDate}
        formTitle={form.title}
      />
    </div>
  );
}

export default function FormDashboardPage() {
  return (
    <Suspense fallback={null}>
      <FormDashboardContent />
    </Suspense>
  );
}

// ============================================================================
// Header — titre + statut + actions
// ============================================================================
function Header({
  form,
  workspaceName,
  menuOpen,
  setMenuOpen,
  onClone,
  onArchiveToggle,
  onToggleTemplate,
  onDelete,
  onCopyLink,
  onMove,
  onEditClosingDate
}: {
  form: Form;
  workspaceName: string | null;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  onClone: () => void;
  onArchiveToggle: () => void;
  onToggleTemplate: () => void;
  onDelete: () => void;
  onCopyLink: () => void;
  onMove: () => void;
  onEditClosingDate: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-4xl">{form.title}</h1>
          {form.is_template && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
              title="Ce formulaire est utilisé comme modèle"
            >
              <LayoutTemplate className="h-3 w-3" />
              Modèle
            </span>
          )}
          {form.status === 'published' && <Badge variant="published">Publié</Badge>}
          {form.status === 'draft' && <Badge variant="draft">Brouillon</Badge>}
          {form.status === 'closed' && <Badge variant="closed">Clos</Badge>}
        </div>
        <p className="papyrus-meta mt-1 text-sm not-italic flex flex-wrap items-center gap-1.5">
          <span>/{form.slug}</span>
          {workspaceName && (
            <>
              <span>·</span>
              <span className="font-semibold text-text-secondary">{workspaceName}</span>
            </>
          )}
          {form.closes_at && (
            <>
              <span>·</span>
              <span className={cn(
                "font-medium flex items-center gap-1",
                new Date(form.closes_at) > new Date() ? 'text-orange-500' : 'text-red-500'
              )}>
                <Clock className="h-3.5 w-3.5" />
                {new Date(form.closes_at) > new Date()
                  ? `Clôture le ${new Date(form.closes_at).toLocaleDateString('fr-FR')} à ${new Date(form.closes_at).toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'})}`
                  : `Clos le ${new Date(form.closes_at).toLocaleDateString('fr-FR')}`
                }
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Link href={`/forms/${form.id}/edit`}>
          <Button iconLeft={<Edit3 className="h-4 w-4" />}>Modifier</Button>
        </Link>

        {/* Menu déroulant pour les actions secondaires */}
        <div className="relative">
          <Button
            variant="secondary"
            iconLeft={<MoreHorizontal className="h-4 w-4" />}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            Actions
          </Button>
          {menuOpen && (
            <>
              {/* Fond invisible pour fermer en cliquant à côté */}
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1.5 w-60 overflow-hidden rounded-md border border-border bg-bg-surface shadow-lg">
                <MenuItem
                  icon={<Link2 className="h-4 w-4" />}
                  label="Copier le lien de partage"
                  hint="Copie l'URL publique du formulaire"
                  onClick={onCopyLink}
                />
                <MenuItem
                  icon={<Copy className="h-4 w-4" />}
                  label="Cloner"
                  hint="Crée une copie en brouillon"
                  onClick={onClone}
                />
                <MenuItem
                  icon={<FolderOpen className="h-4 w-4" />}
                  label="Déplacer"
                  hint="Vers un autre espace de travail"
                  onClick={onMove}
                />
                <MenuItem
                  icon={<Clock className="h-4 w-4" />}
                  label="Date de clôture"
                  hint={form.closes_at ? `Clôture le ${new Date(form.closes_at).toLocaleDateString('fr-FR')}` : "Définir une date limite"}
                  onClick={() => {
                    setMenuOpen(false);
                    onEditClosingDate();
                  }}
                />
                <MenuItem
                  icon={<LayoutTemplate className="h-4 w-4" />}
                  label={form.is_template ? 'Retirer des modèles' : 'Convertir en modèle'}
                  hint={form.is_template ? 'Repasser en formulaire normal' : 'Visible dans Mes modèles'}
                  onClick={onToggleTemplate}
                />
                <MenuItem
                  icon={
                    form.status === 'closed' ? (
                      <ArchiveRestore className="h-4 w-4" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )
                  }
                  label={form.status === 'closed' ? 'Désarchiver' : 'Archiver'}
                  hint={form.status === 'closed' ? 'Repasser en brouillon' : 'Ferme aux nouvelles réponses'}
                  onClick={onArchiveToggle}
                />
                <div className="border-t border-border" />
                <MenuItem
                  icon={<span className="block h-4 w-4 text-danger">×</span>}
                  label="Supprimer"
                  hint="Suppression définitive"
                  onClick={onDelete}
                  danger
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
  danger
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-bg-elevated',
        danger ? 'text-danger hover:bg-danger/10' : 'text-text-primary'
      )}
    >
      <span className={cn('mt-0.5 shrink-0', danger ? 'text-danger' : 'text-text-secondary')}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint && (
          <span className={cn('block text-[11px]', danger ? 'text-danger/80' : 'text-text-tertiary')}>
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

// ============================================================================
// Onglet boutons
// ============================================================================
function TabButton({
  active,
  onClick,
  icon: Icon,
  children
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition',
        active ? 'border-accent text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}
