'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  FileText,
  LayoutTemplate,
  Pencil,
  Plus,
  Sparkles,
  Star,
  TrendingUp
} from 'lucide-react';
import * as Icons from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatCount, cn } from '@/lib/utils';
import { useForms } from '@/lib/store/use-forms';
import { createForm } from '@/lib/store';
import { getWorkspaces } from '@/lib/store/workspaces';
import { cloneTemplate, listTemplatesByScope } from '@/lib/store/templates';
import { FAVORITES_EVENT, listFavorites } from '@/lib/store/favorites';
import { toast } from '@/components/ui/Toast';
import { getUserProfile } from '@/lib/store/team-invitations';
import type { Form, Workspace, UserProfile } from '@/types';

export default function DashboardHome() {
  const forms = useForms();
  const router = useRouter();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [workspacesMap, setWorkspacesMap] = useState<Record<string, string>>({});
  const [workspacesList, setWorkspacesList] = useState<Workspace[]>([]);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Synchro favoris
  useEffect(() => {
    function refresh() {
      setFavorites(new Set(listFavorites()));
    }
    refresh();
    window.addEventListener(FAVORITES_EVENT, refresh);
    return () => window.removeEventListener(FAVORITES_EVENT, refresh);
  }, []);

  // Charger les espaces de travail pour afficher leurs noms sur les cartes
  useEffect(() => {
    const loadWorkspacesData = async () => {
      try {
        const list = await getWorkspaces();
        setWorkspacesList(list);
        setWorkspacesMap(Object.fromEntries(list.map((workspace) => [workspace.id, workspace.name])));
      } catch (err) {
        console.error('Failed to load workspaces:', err);
      }
    };
    loadWorkspacesData();
  }, []);

  // Charger le profil utilisateur pour récupérer le prénom
  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const profile = await getUserProfile();
        setUserProfile(profile);
      } catch (err) {
        console.error('Failed to load user profile:', err);
      }
    };
    loadUserProfile();
  }, []);

  const getWorkspaceName = (form: Form) => {
    const targetId = form.team_id;
    return targetId ? workspacesMap[targetId] : null;
  };

  // Données dérivées
  const totalForms = forms.filter((f) => !f.is_template).length;
  const drafts = forms.filter((f) => !f.is_template && f.status === 'draft');
  const published = forms.filter((f) => !f.is_template && f.status === 'published');
  const recentForms = useMemo(
    () =>
      [...forms]
        .filter((f) => !f.is_template)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 4),
    [forms]
  );

  const favoriteTemplates = useMemo(() => {
    const buckets = listTemplatesByScope(forms);
    const all = [...buckets.global, ...buckets.workspace, ...buckets.personal];
    return all.filter((t) => favorites.has(t.id)).slice(0, 4);
  }, [forms, favorites]);

  // Réponses du mois — placeholder en attendant la collecte
  const responsesThisMonth = '—';

  function handleNew() {
    if (workspacesList.length > 0) {
      setSelectedWorkspaceId(workspacesList[0].id);
      setIsWorkspaceModalOpen(true);
    } else {
      handleConfirmCreate(undefined);
    }
  }

  async function handleConfirmCreate(wsId?: string) {
    setIsWorkspaceModalOpen(false);
    const targetWsId = wsId || selectedWorkspaceId;
    try {
      // Mémorise l'espace choisi pour les créations suivantes.
      if (targetWsId) {
        document.cookie = `papyrus:active-team-id=${targetWsId}; path=/; max-age=31536000; SameSite=Lax`;
      }
      const f = await createForm('Nouveau formulaire', targetWsId);
      router.push(`/forms/${f.id}/edit`);
    } catch (error) {
      console.error('Failed to create form:', error);
      toast.error('Impossible de créer un nouveau formulaire. Veuillez réessayer.');
    }
  }

  async function handleUseTemplate(template: Form) {
    try {
      const cloned = await cloneTemplate(template);
      router.push(`/forms/${cloned.id}/edit`);
    } catch (error) {
      console.error('Failed to clone template:', error);
      toast.error('Impossible de créer le formulaire à partir du modèle. Veuillez réessayer.');
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl">
            {userProfile?.first_name ? `Bonjour ${userProfile.first_name}.` : 'Bonjour.'}
          </h1>
        </div>
        <button
          onClick={handleNew}
          className="inline-flex items-center gap-1.5 rounded-md border border-mooove-cyan bg-mooove-cyan px-3 py-2 text-sm font-medium text-black transition hover:bg-mooove-cyan/90"
        >
          <Plus className="h-4 w-4" />
          Nouveau formulaire
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Formulaires" value={formatCount(totalForms)} icon={<FileText className="h-4 w-4" />} />
        <StatCard
          label="Publiés"
          value={formatCount(published.length)}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Brouillons"
          value={formatCount(drafts.length)}
          icon={<Pencil className="h-4 w-4" />}
        />
        <StatCard
          label="Réponses (mois)"
          value={responsesThisMonth}
          icon={<Sparkles className="h-4 w-4" />}
          hint="bientôt"
        />
      </div>

      {/* Modèles favoris */}
      <section>
        <SectionHeader
          title="Vos modèles favoris"
          icon={<Star className="h-4 w-4 fill-mooove-amber text-mooove-amber" />}
          linkHref="/templates"
          linkLabel="Voir tous les modèles"
        />
        {favoriteTemplates.length === 0 ? (
          <FavoritesEmpty />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {favoriteTemplates.map((t) => (
              <FavoriteTemplateCard key={t.id} template={t} onUse={() => handleUseTemplate(t)} />
            ))}
          </div>
        )}
      </section>

      {/* Formulaires récents */}
      <section>
        <SectionHeader
          title="Formulaires récents"
          icon={<FileText className="h-4 w-4 text-text-secondary" />}
          linkHref="/forms"
          linkLabel="Tout voir"
        />
        {recentForms.length === 0 ? (
          <EmptyForms onCreate={handleNew} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {recentForms.map((f) => (
              <FormCard key={f.id} form={f} workspaceName={getWorkspaceName(f)} />
            ))}
          </div>
        )}
      </section>

      {/* Brouillons inachevés — n'affiche que s'il y en a, et qu'ils ne sont pas déjà tous dans Récents */}
      {drafts.length > 0 && (
        <section>
          <SectionHeader
            title={`Brouillons inachevés (${drafts.length})`}
            icon={<Pencil className="h-4 w-4 text-text-secondary" />}
          />
          <div className="space-y-1.5">
            {drafts.slice(0, 5).map((f) => {
              const wsName = getWorkspaceName(f);
              return (
                <Link
                  key={f.id}
                  href={`/forms/${f.id}/edit`}
                  className="flex items-center justify-between rounded-md border border-border bg-bg-surface px-4 py-2.5 transition hover:border-border-strong hover:bg-bg-elevated"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                    <span className="truncate text-sm text-text-primary">{f.title}</span>
                  </div>
                  <span className="papyrus-meta shrink-0 text-xs">
                    Édité {new Date(f.updated_at).toLocaleDateString('fr-FR')}
                    {wsName ? ` · ${wsName}` : ''}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Modal de choix du workspace pour la création de formulaire */}
      {isWorkspaceModalOpen && typeof window !== 'undefined' && createPortal(
        <Modal
          isOpen={isWorkspaceModalOpen}
          onClose={() => setIsWorkspaceModalOpen(false)}
          title="Créer un nouveau formulaire"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary font-body">
              Dans quel espace de travail souhaitez-vous créer ce formulaire ?
            </p>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {workspacesList.map((ws) => {
                const isSelected = selectedWorkspaceId === ws.id;
                return (
                  <button
                    key={ws.id}
                    onClick={() => setSelectedWorkspaceId(ws.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border p-3.5 text-left transition text-sm",
                      isSelected
                        ? "border-accent bg-accent/5 text-text-primary font-semibold"
                        : "border-border hover:border-border-strong hover:bg-bg-elevated text-text-secondary hover:text-text-primary"
                    )}
                  >
                    <span className="font-medium font-body">{ws.name}</span>
                    <div className={cn(
                      "h-4.5 w-4.5 rounded-full border flex items-center justify-center shrink-0",
                      isSelected ? "border-accent bg-accent text-white" : "border-border bg-bg-surface"
                    )}>
                      {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsWorkspaceModalOpen(false)}
              >
                Annuler
              </Button>
              <Button
                variant="cta"
                size="sm"
                onClick={() => handleConfirmCreate()}
              >
                Confirmer
              </Button>
            </div>
          </div>
        </Modal>,
        document.body
      )}
    </div>
  );
}

// ============================================================================
// Bandeau de section avec lien optionnel "Voir tout"
// ============================================================================
function SectionHeader({
  title,
  icon,
  linkHref,
  linkLabel
}: {
  title: string;
  icon: React.ReactNode;
  linkHref?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-display text-xl">{title}</h2>
      </div>
      {linkHref && linkLabel && (
        <Link
          href={linkHref}
          className="inline-flex items-center gap-1 text-xs text-text-secondary transition hover:text-text-primary"
        >
          {linkLabel} <ArrowRight className="h-3 w-3" />
        </Link>
      )}
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

function FormCard({ form, workspaceName }: { form: Form; workspaceName?: string | null }) {
  return (
    <Link
      href={`/forms/${form.id}`}
      className="group block rounded-lg border border-border bg-bg-surface p-4 transition hover:border-border-strong hover:shadow-sm"
    >
      <div className="flex items-start justify-between">
        <div className="font-display text-lg">{form.title}</div>
        <StatusBadge status={form.status} />
      </div>
      <div className="papyrus-meta mt-1 text-xs space-y-1">
        <div>
          Mis à jour {new Date(form.updated_at).toLocaleDateString('fr-FR')}
          {workspaceName ? ` · ${workspaceName}` : ''} ·{' '}
          {form.fields?.length ?? 0} champ{(form.fields?.length ?? 0) > 1 ? 's' : ''}
        </div>
        {form.closes_at && (
          <div className="flex items-center gap-1 font-medium text-orange-500">
            <span className="h-1 w-1 rounded-full bg-orange-500" />
            {new Date(form.closes_at) > new Date()
              ? `Ferme le ${new Date(form.closes_at).toLocaleDateString('fr-FR')} à ${new Date(form.closes_at).toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'})}`
              : `Fermé`}
          </div>
        )}
      </div>
    </Link>
  );
}

function FavoriteTemplateCard({ template, onUse }: { template: Form; onUse: () => void }) {
  const Icon = resolveIcon(template.template_icon);
  return (
    <button
      type="button"
      onClick={onUse}
      className="group flex flex-col items-start gap-2 rounded-lg border border-border bg-bg-surface p-4 text-left transition hover:border-accent hover:shadow-sm"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-bg-elevated text-text-secondary group-hover:bg-accent/10 group-hover:text-accent">
        <Icon className="h-4 w-4" />
      </div>
      <div className="font-display text-base leading-tight text-text-primary">{template.title}</div>
      {template.template_category && (
        <div className="papyrus-meta text-xs">i. {template.template_category}</div>
      )}
      <div className="mt-1 inline-flex items-center gap-1 text-xs text-accent opacity-0 transition group-hover:opacity-100">
        Utiliser <ArrowRight className="h-3 w-3" />
      </div>
    </button>
  );
}

function FavoritesEmpty() {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-6 text-center">
      <LayoutTemplate className="mx-auto h-7 w-7 text-text-tertiary" />
      <p className="papyrus-meta mt-2 text-sm">
        i. Aucun modèle favori. Cliquez sur l&apos;étoile d&apos;un modèle pour l&apos;épingler ici.
      </p>
      <Link
        href="/templates"
        className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Explorer la bibliothèque
      </Link>
    </div>
  );
}

function EmptyForms({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-bg-surface p-12 text-center">
      <FileText className="mx-auto h-10 w-10 text-text-tertiary" />
      <h3 className="mt-4 font-display text-xl">Aucun formulaire pour l&apos;instant</h3>
      <p className="papyrus-meta mt-1 text-sm">i. Commencez par créer votre premier Papyrus</p>
      <button
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-1.5 rounded-md border border-mooove-cyan bg-mooove-cyan px-3 py-2 text-sm font-medium text-black transition hover:bg-mooove-cyan/90"
      >
        <Plus className="h-4 w-4" />
        Créer un formulaire
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'published') return <Badge variant="published" className="text-xs px-2 py-1">Publié</Badge>;
  if (status === 'closed') return <Badge variant="closed" className="text-xs px-2 py-1">Clos</Badge>;
  return <Badge variant="draft" className="text-xs px-2 py-1">Brouillon</Badge>;
}

/** Résout un nom d'icône Lucide en composant. */
function resolveIcon(name?: string): React.ComponentType<{ className?: string }> {
  if (!name) return LayoutTemplate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lib = Icons as any;
  return (lib[name] as React.ComponentType<{ className?: string }>) ?? LayoutTemplate;
}
