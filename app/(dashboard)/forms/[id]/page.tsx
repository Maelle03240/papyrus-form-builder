'use client';

import { Component, useMemo, useState, useEffect, Suspense, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  Check,
  Clock,
  Copy,
  Download,
  Edit3,
  FolderOpen,
  LayoutTemplate,
  Link2,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plug,
  Settings,
  Share2,
  Trash2,
  TrendingUp,
  Users
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
import type { Form, Field } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { toast } from '@/components/ui/Toast';
import { ClosingDateModal } from '@/components/dashboard/ClosingDateModal';
import { FormShareTab } from '@/components/dashboard/FormShareTab';
import { FormIntegrationsTab } from '@/components/dashboard/FormIntegrationsTab';
import { FormSettingsTab } from '@/components/dashboard/FormSettingsTab';

import { GridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { ChartWidget } from '@/components/dashboard/ChartWidget';
import type { ChartLayoutItem } from '@/types';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell
} from 'recharts';
import { calculateFormScore, DEFAULT_SCORE_LEVELS } from '@/lib/scoring';
import { Award } from 'lucide-react';

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
      <StatsRow submissions={completedSubmissions} loading={submissionsLoading} />

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
        <OverviewTab
          form={form}
          submissions={completedSubmissions}
          loading={submissionsLoading}
        />
      )}
      {tab === 'responses' && (
        <ResponsesTab 
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

// ============================================================================
// Stats (avec les vraies réponses)
// ============================================================================
function StatsRow({ submissions, loading }: { submissions: any[]; loading: boolean }) {
  const count = loading ? '...' : String(submissions.length);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <StatCard label="Réponses" value={count} icon={<Users className="h-4 w-4" />} />
      <StatCard label="Vues" value="—" icon={<TrendingUp className="h-4 w-4" />} hint="bientôt" />
      <StatCard
        label="Taux complétion"
        value="—"
        icon={<BarChart3 className="h-4 w-4" />}
        hint="bientôt"
      />
      <StatCard label="Temps moyen" value="—" icon={<Clock className="h-4 w-4" />} hint="bientôt" />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  hint
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-surface p-5">
      <div className="flex items-center gap-2 text-text-secondary">
        {icon}
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-3 font-display text-3xl">{value}</div>
      {hint && <div className="papyrus-meta mt-1 text-xs">{hint}</div>}
    </div>
  );
}

// ============================================================================
// Helper pour ordonner les graphiques du tableau de bord
// ============================================================================
function getOrderedChartFields(fields: Field[], chartOrder?: string[], deletedCharts?: string[]): Field[] {
  const activeFields = fields.filter(
    f => !['section_break', 'statement', 'image', 'video', 'file'].includes(f.type) &&
         !(deletedCharts ?? []).includes(f.id)
  );

  if (!chartOrder || chartOrder.length === 0) {
    return [...activeFields].sort((a, b) => a.field_order - b.field_order);
  }

  const sorted: Field[] = [];
  chartOrder.forEach(id => {
    const found = activeFields.find(f => f.id === id);
    if (found) {
      sorted.push(found);
    }
  });

  activeFields.forEach(f => {
    if (!sorted.some(s => s.id === f.id)) {
      sorted.push(f);
    }
  });

  return sorted;
}

// ============================================================================
// Construit le layout initial pour react-grid-layout.
// Si chart_layout est déjà stocké, on l'utilise.
// Sinon on génère des positions à partir de orderedFields (qui respecte déjà chart_order).
// ============================================================================
function buildInitialLayout(
  orderedFields: Field[],
  storedLayout: ChartLayoutItem[] | undefined
): LayoutItem[] {
  if (storedLayout && storedLayout.length > 0) {
    return orderedFields.map((field, index) => {
      const stored = storedLayout.find(item => item.field_id === field.id);
      if (stored) return { i: field.id, x: stored.x, y: stored.y, w: stored.w, h: stored.h };
      // Nouveau champ pas encore dans le layout — on l'ajoute en bas
      return { i: field.id, x: index % 2, y: Infinity, w: 1, h: 4 };
    });
  }
  // Pas de layout stocké — on génère depuis l'ordre actuel (respecte chart_order via orderedFields)
  return orderedFields.map((field, index) => ({
    i: field.id,
    x: index % 2,
    y: Math.floor(index / 2) * 4,
    w: 1,
    h: 4,
  }));
}

// ============================================================================
// Générateur HTML standalone — export du formulaire
// ============================================================================
function generateFormHTML(form: Form): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const t = (ml: { fr: string; en?: string } | undefined) =>
    ml ? (ml.fr || ml.en || '') : '';

  const renderField = (field: Field): string => {
    const label = esc(t(field.label));
    const desc = t(field.description);
    const placeholder = esc(t(field.placeholder));
    const req = field.required ? '<span class="req">*</span>' : '';

    switch (field.type) {
      case 'short_text':
      case 'email':
      case 'phone':
      case 'url':
      case 'number':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<input type="${field.type === 'short_text' ? 'text' : field.type}" placeholder="${placeholder}"></div>`;
      case 'long_text':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<textarea rows="4" placeholder="${placeholder}"></textarea></div>`;
      case 'date':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<input type="date"></div>`;
      case 'single_choice':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}${(field.options || []).map(o => `<label class="choice"><input type="radio" name="${esc(field.id)}"><span>${esc(t(o.label))}</span></label>`).join('')}</div>`;
      case 'multiple_choice':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}${(field.options || []).map(o => `<label class="choice"><input type="checkbox"><span>${esc(t(o.label))}</span></label>`).join('')}</div>`;
      case 'dropdown':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<select><option value="">— Choisir —</option>${(field.options || []).map(o => `<option>${esc(t(o.label))}</option>`).join('')}</select></div>`;
      case 'rating':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<div class="rating">☆ ☆ ☆ ☆ ☆</div></div>`;
      case 'nps':
        return `<div class="field"><label>${label}${req}</label>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<div class="nps">${Array.from({ length: 11 }, (_, i) => `<span>${i}</span>`).join('')}</div></div>`;
      case 'section_break':
        return `<div class="section-break"><hr><h3>${label}</h3></div>`;
      case 'statement':
        return `<p class="statement">${label}</p>`;
      default:
        return '';
    }
  };

  const sortedFields = [...(form.fields || [])].sort((a, b) => a.field_order - b.field_order);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(form.title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#EFF9FE;color:#1a1a1a;min-height:100vh;display:flex;justify-content:center;padding:40px 16px}
    .wrap{background:#FFFFFF;border-radius:16px;padding:48px;max-width:680px;width:100%;border:1px solid #C7EAFB}
    h1{font-size:2rem;font-weight:700;margin-bottom:8px}
    .form-desc{color:#666;margin-bottom:40px;line-height:1.6}
    .field{margin-bottom:28px}
    label{display:block;font-weight:600;font-size:.95rem;margin-bottom:8px}
    .req{color:#e05;margin-left:3px}
    .desc{font-size:.83rem;color:#777;margin-bottom:8px;font-weight:400}
    input[type=text],input[type=email],input[type=tel],input[type=url],input[type=number],input[type=date],textarea,select{width:100%;padding:10px 14px;border:1.5px solid #C7EAFB;border-radius:8px;font-size:.95rem;background:#fff;font-family:inherit}
    textarea{resize:vertical}
    .choice{display:flex;align-items:center;gap:8px;font-weight:400;margin-top:6px;cursor:pointer}
    .choice input{width:auto;margin:0}
    .rating{font-size:1.8rem;letter-spacing:4px;color:#F6923E;margin-top:4px}
    .nps{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    .nps span{width:38px;height:38px;border:1.5px solid #C7EAFB;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.9rem;cursor:pointer}
    .section-break{margin:32px 0 20px}
    .section-break hr{border:none;border-top:1.5px solid #C7EAFB;margin-bottom:16px}
    .section-break h3{font-size:1.1rem;font-weight:700}
    .statement{color:#555;line-height:1.6;margin-bottom:8px}
    button[type=submit]{margin-top:32px;background:#052139;color:#fff;border:none;padding:14px 32px;border-radius:12px;font-size:1rem;font-weight:600;cursor:pointer;font-family:inherit}
    button[type=submit]:hover{background:#0a3a5c}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${esc(form.title)}</h1>
    ${form.description ? `<p class="form-desc">${esc(form.description)}</p>` : ''}
    <form>
      ${sortedFields.map(renderField).join('\n      ')}
      <button type="submit">Envoyer</button>
    </form>
  </div>
</body>
</html>`;
}

// ============================================================================
// ErrorBoundary par widget — isole les crashs de rendu de chaque graphique
// ============================================================================
interface ChartErrorBoundaryProps {
  children: ReactNode;
  fieldLabel: string;
}
interface ChartErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

class ChartErrorBoundary extends Component<ChartErrorBoundaryProps, ChartErrorBoundaryState> {
  constructor(props: ChartErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ChartErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error) {
    console.error(`[ChartWidget] Erreur de rendu pour "${this.props.fieldLabel}":`, error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-5 min-h-[120px] flex flex-col justify-center gap-2">
          <p className="text-xs font-semibold text-danger">
            Erreur de rendu — {this.props.fieldLabel}
          </p>
          <p className="text-[11px] font-mono text-text-tertiary break-all">
            {this.state.errorMessage}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// Onglet Vue d'ensemble — Graphiques automatiques et interactifs
// ============================================================================
interface OverviewTabProps {
  form: Form;
  submissions: any[];
  loading: boolean;
}

function OverviewTab({ form, submissions, loading }: OverviewTabProps) {
  const [localForm, setLocalForm] = useState<Form>(form);

  useEffect(() => {
    if (!form) return;
    setLocalForm(prev => {
      if (prev.id !== form.id) return form;
      if (prev.updated_at === form.updated_at) return prev;
      return form;
    });
  }, [form]);

  const dashboardConfig = localForm.theme.dashboard_config ?? {};
  const chartOrder = dashboardConfig.chart_order ?? [];
  const deletedCharts = dashboardConfig.deleted_charts ?? [];
  const chartTitles = dashboardConfig.chart_titles ?? {};
  const chartMatrixTypes = dashboardConfig.chart_matrix_types ?? {};

  // Calcule les statistiques du score si activé
  const scoreStats = useMemo(() => {
    if (!localForm.scoring_enabled || submissions.length === 0) return null;

    let totalPercentage = 0;
    let totalScoreSum = 0;
    let maxScoreSum = 0;
    let scoredCount = 0;

    const levels = localForm.theme.score_levels && localForm.theme.score_levels.length > 0
      ? localForm.theme.score_levels
      : DEFAULT_SCORE_LEVELS;

    const distribution = levels.map(level => ({
      ...level,
      count: 0
    }));

    submissions.forEach(sub => {
      const result = calculateFormScore(localForm, sub.responses || {});
      if (result) {
        totalPercentage += result.percentage;
        totalScoreSum += result.totalScore;
        maxScoreSum += result.maxScore;
        scoredCount++;

        const sortedLevels = [...distribution].sort((a, b) => b.minPercent - a.minPercent);
        const matched = sortedLevels.find(l => result.percentage >= l.minPercent) || sortedLevels[sortedLevels.length - 1];
        if (matched) {
          matched.count++;
        }
      }
    });

    if (scoredCount === 0) return null;

    const avgPercentage = Math.round(totalPercentage / scoredCount);
    const avgScore = (totalScoreSum / scoredCount).toFixed(1);
    const avgMaxScore = (maxScoreSum / scoredCount).toFixed(1);

    const sortedLevels = [...levels].sort((a, b) => b.minPercent - a.minPercent);
    const matchedLevel = sortedLevels.find(l => avgPercentage >= l.minPercent) || sortedLevels[sortedLevels.length - 1];

    return {
      avgPercentage,
      avgScore,
      avgMaxScore,
      scoredCount,
      distribution,
      matchedLevel
    };
  }, [localForm, submissions]);

  const LEVEL_COLORS: Record<string, { text: string; bg: string; border: string; hex: string }> = {
    green: {
      text: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/20',
      border: 'border-emerald-200 dark:border-emerald-900/40',
      hex: '#10B981'
    },
    blue: {
      text: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-950/20',
      border: 'border-blue-200 dark:border-blue-900/40',
      hex: '#3B82F6'
    },
    orange: {
      text: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/20',
      border: 'border-amber-200 dark:border-amber-900/40',
      hex: '#F59E0B'
    },
    red: {
      text: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-50 dark:bg-rose-950/20',
      border: 'border-rose-200 dark:border-rose-900/40',
      hex: '#EF4444'
    }
  };

  // Filtrer et ordonner les champs à afficher
  const orderedFields = useMemo(() => {
    return getOrderedChartFields(localForm.fields ?? [], chartOrder, deletedCharts);
  }, [localForm.fields, chartOrder, deletedCharts]);

  // Mesure dynamique de la largeur du conteneur pour react-grid-layout v2
  const { width: gridContainerWidth, containerRef: gridContainerRef, mounted: gridMounted } = useContainerWidth();

  // Layout react-grid-layout — initialisé depuis chart_layout ou dérivé de chart_order
  const [gridLayout, setGridLayout] = useState<LayoutItem[]>(() =>
    buildInitialLayout(orderedFields, dashboardConfig.chart_layout)
  );

  // Sync quand des champs sont ajoutés ou supprimés (preserve les positions existantes)
  useEffect(() => {
    setGridLayout((prev: LayoutItem[]) => {
      const next: LayoutItem[] = orderedFields.map((field, index) => {
        const existing = prev.find((l: LayoutItem) => l.i === field.id);
        return existing ?? { i: field.id, x: index % 2, y: Infinity, w: 1, h: 4 };
      });
      const sameSet =
        next.length === prev.length && next.every((l: LayoutItem, i: number) => l.i === prev[i]?.i);
      return sameSet ? prev : next;
    });
  }, [orderedFields]);

  // Persiste le layout après fin d'un drag ou d'un resize (EventCallback reçoit Layout = readonly LayoutItem[])
  const handleSaveLayout = async (newLayout: Layout): Promise<void> => {
    const chartLayout: ChartLayoutItem[] = [...newLayout].map((item: LayoutItem) => ({
      field_id: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    }));

    const config = localForm.theme.dashboard_config ?? {};
    const updatedTheme = {
      ...localForm.theme,
      dashboard_config: { ...config, chart_layout: chartLayout },
    };

    setLocalForm(prev => ({ ...prev, theme: updatedTheme }));

    try {
      await updateForm(localForm.id, { theme: updatedTheme });
    } catch (error) {
      console.error('Failed to save chart layout:', error);
      toast.error('Erreur lors de la sauvegarde du layout');
    }
  };

  // Callback de changement de titre
  const handleTitleChange = async (fieldId: string, newTitle: string) => {
    const config = localForm.theme.dashboard_config ?? {};
    const titles = { ...(config.chart_titles ?? {}), [fieldId]: newTitle };
    const updatedTheme = {
      ...localForm.theme,
      dashboard_config: { ...config, chart_titles: titles }
    };
    
    // Mise à jour optimiste
    setLocalForm(prev => ({ ...prev, theme: updatedTheme }));
    
    try {
      await updateForm(localForm.id, { theme: updatedTheme });
      toast.success('Titre du graphique mis à jour');
    } catch (error) {
      console.error('Failed to update chart title:', error);
      toast.error('Erreur lors de la mise à jour du titre');
      setLocalForm(form);
    }
  };

  // Callback de suppression d'un widget du dashboard
  const handleDeleteWidget = async (fieldId: string) => {
    const config = localForm.theme.dashboard_config ?? {};
    const deleted = [...(config.deleted_charts ?? []), fieldId];
    const updatedTheme = {
      ...localForm.theme,
      dashboard_config: { ...config, deleted_charts: deleted }
    };

    setLocalForm(prev => ({ ...prev, theme: updatedTheme }));

    try {
      await updateForm(localForm.id, { theme: updatedTheme });
      toast.success('Graphique masqué du tableau de bord');
    } catch (error) {
      console.error('Failed to delete chart:', error);
      toast.error('Erreur lors du masquage du graphique');
      setLocalForm(form);
    }
  };

  // Callback de changement du type de rendu pour une matrice (heatmap ou barres)
  function handleExportPDF() {
    window.print();
  }

  function handleExportHTML() {
    const html = generateFormHTML(localForm);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${localForm.slug || localForm.id}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const handleMatrixTypeChange = async (fieldId: string, type: 'heatmap' | 'bar') => {
    const config = localForm.theme.dashboard_config ?? {};
    const matrixTypes = { ...(config.chart_matrix_types ?? {}), [fieldId]: type };
    const updatedTheme = {
      ...localForm.theme,
      dashboard_config: { ...config, chart_matrix_types: matrixTypes }
    };

    setLocalForm(prev => ({ ...prev, theme: updatedTheme }));

    try {
      await updateForm(localForm.id, { theme: updatedTheme });
    } catch (error) {
      console.error('Failed to update matrix rendering:', error);
      setLocalForm(form);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-sm text-text-tertiary">
        Chargement des graphiques...
      </div>
    );
  }

  if (submissions.length === 0) {
    const activeChartableCount = (localForm.fields ?? []).filter(
      f => !['section_break', 'statement', 'image', 'video', 'file'].includes(f.type)
    ).length;

    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-10 text-center">
          <BarChart3 className="mx-auto h-10 w-10 text-text-tertiary" />
          <h3 className="mt-4 font-display text-xl">Pas encore de réponses à analyser</h3>
          <p className="papyrus-meta mx-auto mt-1 max-w-md text-sm">
            i. Quand les premières réponses arriveront, un graphique sera automatiquement
            généré pour chacun des {activeChartableCount} champ{activeChartableCount > 1 ? 's' : ''} mesurable{activeChartableCount > 1 ? 's' : ''} de ce formulaire.
          </p>
        </div>
      </div>
    );
  }

  // S'il n'y a aucun graphique à afficher car ils ont tous été masqués
  if (orderedFields.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-10 text-center">
        <BarChart3 className="mx-auto h-10 w-10 text-text-tertiary" />
        <h3 className="mt-4 font-display text-xl">Tableau de bord vide</h3>
        <p className="papyrus-meta mx-auto mt-1 max-w-md text-sm">
          Tous les graphiques ont été masqués. Réinitialisez la configuration du tableau de bord ou rajoutez des questions pour générer de nouveaux graphiques.
        </p>
        <button
          onClick={async () => {
            const updatedTheme = {
              ...localForm.theme,
              dashboard_config: {}
            };
            setLocalForm(prev => ({ ...prev, theme: updatedTheme }));
            await updateForm(localForm.id, { theme: updatedTheme });
            toast.success('Tableau de bord réinitialisé');
          }}
          className="mt-4 rounded bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover transition"
        >
          Réinitialiser le tableau de bord
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Score de maturité */}
      {localForm.scoring_enabled && scoreStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1 : score moyen */}
          <div className="rounded-xl border border-border bg-bg-surface p-6 flex items-center gap-4">
            <div className="rounded-full bg-accent/10 p-2.5 shrink-0">
              <Award className="h-6 w-6 text-accent" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-secondary">
                {localForm.theme.score_label || 'Score de maturité moyen'}
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold text-text-primary">
                  {scoreStats.avgPercentage}%
                </span>
                <span className="text-xs font-mono text-text-tertiary">
                  ({scoreStats.avgScore} / {scoreStats.avgMaxScore} pts)
                </span>
              </div>
            </div>
          </div>

          {/* Card 2 : distribution par niveau */}
          <div className="rounded-xl border border-border bg-bg-surface p-6 flex flex-col min-h-[160px]">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-text-secondary" />
              <h3 className="font-display text-sm font-semibold text-text-primary">Distribution par niveau</h3>
            </div>
            <div className="w-full" style={{ height: 140 }}>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart
                  data={scoreStats.distribution}
                  layout="vertical"
                  margin={{ top: 4, right: 15, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-weak)" />
                  <XAxis type="number" allowDecimals={false} stroke="var(--text-tertiary)" fontSize={10} />
                  <YAxis dataKey="title" type="category" stroke="var(--text-tertiary)" fontSize={10} width={100} />
                  <Tooltip
                    formatter={(value) => [`${value} répondant${Number(value) > 1 ? 's' : ''}`]}
                    contentStyle={{ fontSize: 11, backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={16}>
                    {scoreStats.distribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={LEVEL_COLORS[entry.color]?.hex || 'var(--accent)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <h2 className="font-display text-xl">
          {localForm.title}
          <span className="ml-2 text-base font-normal text-text-tertiary font-body">
            ({submissions.length} répondant{submissions.length > 1 ? 's' : ''})
          </span>
        </h2>
        <div className="flex items-center gap-1.5 print:hidden">
          <Button variant="ghost" onClick={handleExportHTML} className="h-8 gap-1.5 px-3 text-xs text-text-tertiary hover:text-text-primary">
            <Download className="h-3.5 w-3.5" />
            HTML
          </Button>
          <Button variant="ghost" onClick={handleExportPDF} className="h-8 gap-1.5 px-3 text-xs text-text-tertiary hover:text-text-primary">
            <Download className="h-3.5 w-3.5" />
            PDF
          </Button>
        </div>
      </div>

      <div ref={gridContainerRef as RefObject<HTMLDivElement>}>
        {gridMounted && (
          <GridLayout
            width={gridContainerWidth}
            layout={gridLayout}
            gridConfig={{ cols: 2, rowHeight: 80, margin: [24, 24] as readonly [number, number] }}
            dragConfig={{ handle: '.chart-drag-handle', threshold: 6 }}
            resizeConfig={{ handles: ['se'] as const }}
            compactor={verticalCompactor}
            onLayoutChange={(newLayout: Layout) => setGridLayout([...newLayout])}
            onDragStop={handleSaveLayout}
            onResizeStop={handleSaveLayout}
          >
            {orderedFields.map((field) => {
              const fieldTitle = chartTitles[field.id] || field.label.fr || 'Question sans titre';
              const matrixType = chartMatrixTypes[field.id] || 'heatmap';

              return (
                <div key={field.id} className="chart-widget-grid-item">
                  <ChartErrorBoundary fieldLabel={fieldTitle}>
                    <ChartWidget
                      field={field}
                      submissions={submissions}
                      title={fieldTitle}
                      theme={localForm.theme}
                      matrixType={matrixType}
                      onTitleChange={(newTitle: string) => handleTitleChange(field.id, newTitle)}
                      onDelete={() => handleDeleteWidget(field.id)}
                      onMatrixTypeChange={(type: 'heatmap' | 'bar') => handleMatrixTypeChange(field.id, type)}
                    />
                  </ChartErrorBoundary>
                </div>
              );
            })}
          </GridLayout>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Onglet Réponses — table brute + export + delete + copy + edit inline
// ============================================================================
interface ResponsesTabProps {
  form: Form;
  submissions: any[];
  setSubmissions: React.Dispatch<React.SetStateAction<any[]>>;
  loading: boolean;
}

function ResponsesTab({ form, submissions: allSubmissions, setSubmissions, loading }: ResponsesTabProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ subId: string; fieldId: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editedCells, setEditedCells] = useState<Set<string>>(new Set());
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [showPartials, setShowPartials] = useState(false);

  const partialCount = allSubmissions.filter((s) => s.is_partial).length;

  // Par défaut, le tableau ne montre que les réponses abouties : c'est ce qu'on
  // exporte, ce qu'on compte, et ce que l'auteur du formulaire appelle « une
  // réponse ». Les ébauches sont accessibles d'un clic, jamais mélangées sans
  // qu'on l'ait demandé.
  const submissions = showPartials
    ? allSubmissions
    : allSubmissions.filter((s) => !s.is_partial);

  const fields = (form.fields ?? []).filter(
    (f) => f.type !== 'section_break' && f.type !== 'statement' && f.type !== 'image' && f.type !== 'video'
  );

  function renderResponseValue(field: Field, value: any): string {
    if (value === undefined || value === null || value === '') return '—';

    if (['single_choice', 'multiple_choice', 'dropdown'].includes(field.type)) {
      const getOptionLabel = (optId: string) => {
        const option = field.options?.find((o: any) => o.id === optId);
        return option ? (option.label.fr || option.label.en || optId) : optId;
      };
      if (Array.isArray(value)) return value.map(getOptionLabel).join(', ');
      if (typeof value === 'string') {
        if (value.includes(',') && !field.options?.some((o: any) => o.id === value)) {
          return value.split(',').map((v) => getOptionLabel(v.trim())).join(', ');
        }
        return getOptionLabel(value);
      }
    }

    if (field.type === 'matrix') {
      if (typeof value === 'object') {
        return Object.entries(value)
          .map(([rowId, colId]) => {
            const row = field.rows?.find((r: any) => r.id === rowId);
            const col = field.options?.find((c: any) => c.id === colId as string);
            const rowLabel = row ? (row.label.fr || row.label.en || rowId) : rowId;
            const colLabel = col ? (col.label.fr || col.label.en || colId) : colId;
            return `${rowLabel} : ${colLabel}`;
          })
          .join(' | ');
      }
    }

    if (typeof value === 'object') {
      if (Array.isArray(value)) return value.join(', ');
      return JSON.stringify(value);
    }
    return String(value);
  }

  async function handleDelete(subId: string) {
    const supabase = createClient();
    const { error } = await supabase.from('submissions').delete().eq('id', subId);
    if (!error) {
      setSubmissions((prev) => prev.filter((s) => s.id !== subId));
      toast.success('Réponse supprimée');
    } else {
      console.error('Failed to delete submission:', error);
      toast.error('Erreur lors de la suppression');
    }
    setConfirmDeleteId(null);
  }

  async function handleCopyCell(text: string, cellKey: string) {
    if (text === '—') return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCell(cellKey);
      setTimeout(() => setCopiedCell(null), 1500);
    } catch {
      toast.error('Impossible de copier');
    }
  }

  function startEdit(subId: string, fieldId: string, renderedValue: string) {
    setEditingCell({ subId, fieldId });
    setEditValue(renderedValue === '—' ? '' : renderedValue);
  }

  async function saveEdit() {
    if (!editingCell) return;
    const { subId, fieldId } = editingCell;
    const sub = submissions.find((s) => s.id === subId);
    if (!sub) { setEditingCell(null); return; }

    const newResponses = { ...(sub.responses ?? {}), [fieldId]: editValue };
    const supabase = createClient();
    const { error } = await supabase
      .from('submissions')
      .update({ responses: newResponses })
      .eq('id', subId);

    if (!error) {
      setSubmissions((prev) =>
        prev.map((s) => (s.id === subId ? { ...s, responses: newResponses } : s))
      );
      setEditedCells((prev) => new Set([...prev, `${subId}:${fieldId}`]));
    } else {
      console.error('Failed to update submission:', error);
      toast.error('Erreur lors de la modification');
    }
    setEditingCell(null);
  }

  const handleExportExcel = () => {
    import('xlsx').then((XLSX) => {
      const data = submissions.map((sub) => {
        const row: Record<string, any> = {};
        fields.forEach((f) => {
          const headerName = f.label.fr || 'Champ sans nom';
          row[headerName] = renderResponseValue(f, sub.responses?.[f.id]);
        });
        row['Date de soumission'] = new Date(sub.completed_at).toLocaleString('fr-FR');
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Réponses');

      const slugTitle = form.title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
      const dateStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `${slugTitle}-reponses-${dateStr}.xlsx`);
    });
  };

  if (loading) {
    return <div className="py-12 text-center papyrus-meta text-sm">Chargement des réponses...</div>;
  }

  const partialToggle = partialCount > 0 && (
    <button
      type="button"
      onClick={() => setShowPartials((v) => !v)}
      className="text-xs text-accent hover:underline"
    >
      {showPartials
        ? 'Masquer les réponses partielles'
        : `Afficher les ${partialCount} réponse${partialCount > 1 ? 's' : ''} partielle${partialCount > 1 ? 's' : ''}`}
    </button>
  );

  if (submissions.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="font-display text-xl">Réponses brutes</h2>
        <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-12 text-center">
          <ListChecks className="mx-auto h-10 w-10 text-text-tertiary" />
          <h3 className="mt-4 font-display text-xl">Aucune réponse pour l&apos;instant</h3>
          <p className="papyrus-meta mx-auto mt-1 max-w-md text-sm">
            i. Partagez le lien de votre formulaire pour commencer à collecter des réponses.
          </p>
          {partialToggle && <div className="mt-4">{partialToggle}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-xl">Réponses brutes ({submissions.length})</h2>
          {partialToggle}
        </div>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Download className="h-3.5 w-3.5" />}
          onClick={handleExportExcel}
        >
          Exporter Excel
        </Button>
      </div>

      <div className="w-full overflow-x-auto rounded-lg border border-border bg-bg-surface">
        <table className="w-full border-collapse text-left text-sm text-text-primary">
          <thead className="border-b border-border bg-bg-elevated text-xs font-semibold uppercase text-text-secondary">
            <tr>
              <th className="w-8 px-2 py-3" />
              <th className="px-4 py-3 min-w-[150px]">Date de soumission</th>
              {fields.map((f) => (
                <th key={f.id} className="px-4 py-3 min-w-[200px] max-w-[350px] truncate">
                  {f.label.fr || 'Champ sans nom'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {submissions.map((sub) => (
              <tr
                key={sub.id}
                className={cn(
                  'group/row hover:bg-bg-elevated transition-colors',
                  confirmDeleteId === sub.id && 'bg-danger/5'
                )}
              >
                {/* Colonne suppression */}
                <td className="w-8 px-2 py-3">
                  {confirmDeleteId === sub.id ? (
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <button
                        onClick={() => handleDelete(sub.id)}
                        className="text-[11px] font-semibold text-danger hover:underline"
                      >
                        Oui
                      </button>
                      <span className="text-[11px] text-text-tertiary">/</span>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[11px] text-text-secondary hover:underline"
                      >
                        Non
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(sub.id)}
                      className="invisible group-hover/row:visible text-text-tertiary hover:text-danger transition-colors"
                      title="Supprimer cette réponse"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>

                {/* Date */}
                <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-text-secondary">
                  {new Date(sub.completed_at).toLocaleString('fr-FR')}
                  {sub.is_partial && (
                    <span
                      className="ml-2 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-warning"
                      title="Ébauche : le formulaire n'a jamais été envoyé"
                    >
                      partielle
                    </span>
                  )}
                </td>

                {/* Cellules de réponse */}
                {fields.map((f) => {
                  const val = sub.responses?.[f.id];
                  const renderedVal = renderResponseValue(f, val);
                  const isUrl = typeof renderedVal === 'string' &&
                    (renderedVal.startsWith('http://') || renderedVal.startsWith('https://'));
                  const cellKey = `${sub.id}:${f.id}`;
                  const isEditing = editingCell?.subId === sub.id && editingCell?.fieldId === f.id;
                  const isEdited = editedCells.has(cellKey);
                  const isCopied = copiedCell === cellKey;

                  return (
                    <td key={f.id} className="group/cell px-4 py-3 max-w-[350px]">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                            if (e.key === 'Escape') setEditingCell(null);
                          }}
                          className="w-full rounded border border-accent bg-bg-base px-2 py-0.5 text-sm focus:outline-none"
                        />
                      ) : (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="flex-1 truncate" title={renderedVal}>
                            {isEdited && (
                              <span className="mr-1 text-[10px] text-text-tertiary" title="Modifié manuellement">
                                ✎
                              </span>
                            )}
                            {isUrl ? (
                              <a
                                href={renderedVal}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                              >
                                Ouvrir le fichier ↗
                              </a>
                            ) : (
                              renderedVal
                            )}
                          </span>
                          {renderedVal !== '—' && (
                            <div className="invisible flex shrink-0 items-center gap-0.5 group-hover/cell:visible">
                              <button
                                onClick={() => handleCopyCell(renderedVal, cellKey)}
                                className="rounded p-0.5 text-text-tertiary transition-colors hover:bg-bg-elevated hover:text-text-primary"
                                title="Copier"
                              >
                                {isCopied ? (
                                  <Check className="h-3 w-3 text-green-500" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                              {!isUrl && (
                                <button
                                  onClick={() => startEdit(sub.id, f.id, renderedVal)}
                                  className="rounded p-0.5 text-text-tertiary transition-colors hover:bg-bg-elevated hover:text-text-primary"
                                  title="Modifier"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}