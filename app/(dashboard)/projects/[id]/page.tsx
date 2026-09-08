'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  BarChart3,
  FileText,
  Handshake,
  ListChecks,
  Plus,
  Settings as SettingsIcon
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { FormCard } from '@/components/dashboard/FormCard';
import { WorkspaceTabs, type TabItem } from '@/components/dashboard/WorkspaceTabs';
import { ModuleUnavailable } from '@/components/dashboard/ModuleUnavailable';
import { ProjectRecordsTab } from '@/components/dashboard/ProjectRecordsTab';
import {
  getProject,
  getProjectForms,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  createForm,
  cloneForm,
  deleteForm
} from '@/lib/store';
import { createClient } from '@/lib/supabase/client';
import type { Form, Project, ProjectInvoicing, ProjectPricing } from '@/types';
import { Switch } from '@/components/ui/Switch';
import { formatMoney } from '@/lib/pricing';

type Tab = 'forms' | 'records' | 'partners' | 'insights' | 'settings';
const TABS: Tab[] = ['forms', 'records', 'partners', 'insights', 'settings'];

function ProjectWorkspace() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const requested = searchParams.get('tab');
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'forms';

  const [project, setProject] = useState<Project | null>(null);
  const [forms, setForms] = useState<Form[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const [loadedProject, loadedForms] = await Promise.all([
        getProject(params.id),
        getProjectForms(params.id)
      ]);

      if (!loadedProject) {
        setNotFound(true);
        return;
      }

      setProject(loadedProject);
      setForms(loadedForms);
    } catch (error) {
      console.error('Failed to load project:', error);
      toast.error("Le projet n'a pas pu être chargé.");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Nombre de réponses abouties par formulaire.
   *
   * Compté par `head: true` : on ne rapatrie aucune ligne, seulement le total.
   * Les réponses partielles sont exclues — une ébauche en cours de saisie n'est
   * pas une réponse, et la compter ferait mentir tous les chiffres de la page.
   */
  const loadCounts = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const supabase = createClient();

    const entries = await Promise.all(
      ids.map(async (formId) => {
        const { count } = await supabase
          .from('submissions')
          .select('id', { count: 'exact', head: true })
          .eq('form_id', formId)
          .eq('is_partial', false);
        return [formId, count ?? 0] as const;
      })
    );

    setCounts(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void loadCounts(forms.map((form) => form.id));
  }, [forms, loadCounts]);

  const totalResponses = useMemo(
    () => Object.values(counts).reduce((sum, value) => sum + value, 0),
    [counts]
  );

  const tabHref = useCallback(
    (key: Tab) => (key === 'forms' ? `/projects/${params.id}` : `/projects/${params.id}?tab=${key}`),
    [params.id]
  );

  const tabs: TabItem[] = useMemo(
    () => [
      { key: 'forms', label: 'Formulaires', href: tabHref('forms'), icon: FileText, count: forms.length },
      { key: 'records', label: 'Réponses', href: tabHref('records'), icon: ListChecks, count: totalResponses },
      {
        key: 'partners',
        label: 'Partenaires',
        href: tabHref('partners'),
        icon: Handshake
      },
      { key: 'insights', label: 'Analyse', href: tabHref('insights'), icon: BarChart3 },
      { key: 'settings', label: 'Paramètres', href: tabHref('settings'), icon: SettingsIcon }
    ],
    [forms.length, tabHref, totalResponses]
  );

  const handleCreateForm = useCallback(async () => {
    if (!project) return;
    try {
      const form = await createForm('Nouveau formulaire', project.team_id, project.id);
      router.push(`/projects/${project.id}/forms/${form.id}`);
    } catch (error) {
      console.error('Failed to create form:', error);
      toast.error("Le formulaire n'a pas pu être créé.");
    }
  }, [project, router]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10" aria-busy="true">
        <div className="h-7 w-56 animate-pulse rounded-md bg-bg-elevated" />
        <div className="mt-8 h-40 animate-pulse rounded-xl bg-bg-elevated" />
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center">
        <h1 className="font-display text-lg font-bold text-text-primary">Projet introuvable</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Il a peut-être été supprimé, ou appartient à un espace de travail auquel vous n&apos;avez
          plus accès.
        </p>
        <Button className="mt-6" variant="secondary" onClick={() => router.push('/projects')}>
          Revenir aux projets
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="px-6 pt-8">
        <nav className="text-xs text-text-tertiary" aria-label="Fil d'Ariane">
          <Link href="/projects" className="transition hover:text-text-secondary">
            Projets
          </Link>
        </nav>
        <h1 className="mt-1 font-display text-2xl font-bold text-text-primary">{project.name}</h1>
        {project.description && (
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">{project.description}</p>
        )}
      </header>

      <div className="mt-6">
        <WorkspaceTabs items={tabs} active={tab} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'forms' && (
          <FormsTab
            forms={forms}
            projectId={project.id}
            onCreate={handleCreateForm}
            onChanged={load}
          />
        )}

        {tab === 'records' && <ProjectRecordsTab forms={forms} projectId={project.id} />}

        {tab === 'partners' && (
          <ModuleUnavailable
            icon={Handshake}
            title="Partenaires"
            description="Les partenaires promeuvent un projet avec leur propre lien de partage, suivent leurs inscriptions depuis un portail dédié, et voient les commissions qui leur reviennent."
          />
        )}

        {tab === 'insights' && (
          <ModuleUnavailable
            icon={BarChart3}
            title="Analyse du projet"
            description="Les réponses de tous les formulaires du projet, réunies sur un même tableau de bord. En attendant, chaque formulaire porte ses propres graphiques dans son onglet Analyse."
          />
        )}

        {tab === 'settings' && <SettingsTab project={project} onChanged={load} />}
      </div>
    </div>
  );
}

// ============================================================================
// Formulaires
// ============================================================================

function FormsTab({
  forms,
  projectId,
  onCreate,
  onChanged
}: {
  forms: Form[];
  projectId: string;
  onCreate: () => void;
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();

  const open = (formId: string) => router.push(`/projects/${projectId}/forms/${formId}`);

  const duplicate = async (formId: string) => {
    try {
      await cloneForm(formId, undefined, projectId);
      await onChanged();
      toast.success('Formulaire dupliqué.');
    } catch (error) {
      console.error('Failed to duplicate form:', error);
      toast.error('La duplication a échoué.');
    }
  };

  const remove = async (formId: string) => {
    try {
      await deleteForm(formId);
      await onChanged();
      toast.success('Formulaire supprimé.');
    } catch (error) {
      console.error('Failed to delete form:', error);
      toast.error('La suppression a échoué.');
    }
  };

  if (forms.length === 0) {
    return (
      <div className="px-6 py-16">
        <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <FileText className="mx-auto h-6 w-6 text-text-tertiary" />
          <h2 className="mt-4 font-display text-lg font-bold text-text-primary">
            Ce projet n&apos;a pas encore de formulaire
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">
            Un projet peut en contenir plusieurs : une inscription, une enquête de satisfaction, un
            bon de commande.
          </p>
          <Button className="mt-6" iconLeft={<Plus className="h-4 w-4" />} onClick={onCreate}>
            Créer un formulaire
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8">
      <div className="mb-4 flex justify-end">
        <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={onCreate}>
          Nouveau formulaire
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {forms.map((form) => (
          <FormCard
            key={form.id}
            form={form}
            onEdit={open}
            onDuplicate={(id) => void duplicate(id)}
            onDelete={(id) => void remove(id)}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Paramètres du projet
// ============================================================================

function SettingsTab({ project, onChanged }: { project: Project; onChanged: () => Promise<void> }) {
  const router = useRouter();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = name.trim() !== project.name || description !== project.description;

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await updateProject(project.id, { name: name.trim(), description });
      await onChanged();
      toast.success('Projet enregistré.');
    } catch (error) {
      console.error('Failed to save project:', error);
      toast.error("L'enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = async () => {
    try {
      if (project.status === 'archived') {
        await unarchiveProject(project.id);
        toast.success('Projet réactivé.');
      } else {
        await archiveProject(project.id);
        toast.success('Projet archivé.');
      }
      await onChanged();
    } catch (error) {
      console.error('Failed to change project status:', error);
      toast.error("Le statut n'a pas pu être changé.");
    }
  };

  const remove = async () => {
    try {
      await deleteProject(project.id);
      toast.success('Projet supprimé.');
      router.push('/projects');
    } catch (error) {
      console.error('Failed to delete project:', error);
      toast.error('La suppression a échoué.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <section className="rounded-xl border border-border bg-bg-surface p-6">
        <h2 className="font-display text-base font-bold text-text-primary">Identité</h2>
        <div className="mt-4 space-y-4">
          <Input
            label="Nom du projet"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="space-y-1.5">
            <label htmlFor="project-description" className="block text-sm text-text-secondary">
              Description
            </label>
            <textarea
              id="project-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="À quoi sert ce projet ?"
              className="w-full rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary transition focus:border-accent focus:outline-hidden focus:ring-2 focus:ring-accent-cta/20"
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" loading={saving} disabled={!dirty || !name.trim()} onClick={() => void save()}>
              Enregistrer
            </Button>
          </div>
        </div>
      </section>

      <ProjectPricingSection project={project} onChanged={onChanged} />

      <ProjectInvoicingSection project={project} onChanged={onChanged} />

      <section className="mt-6 rounded-xl border border-border bg-bg-surface p-6">
        <h2 className="font-display text-base font-bold text-text-primary">Cycle de vie</h2>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-sm text-sm text-text-secondary">
            {project.status === 'archived'
              ? 'Ce projet est archivé : il reste consultable mais sort de la liste principale.'
              : 'Archiver retire le projet de la liste principale sans rien supprimer.'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void toggleArchive()}>
            {project.status === 'archived' ? 'Réactiver' : 'Archiver'}
          </Button>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-danger/30 bg-danger/5 p-6">
        <h2 className="font-display text-base font-bold text-text-primary">Supprimer le projet</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-sm text-sm text-text-secondary">
            Tous ses formulaires, leurs questions et leurs réponses seront supprimés avec lui. C&apos;est
            irréversible.
          </p>
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            Supprimer
          </Button>
        </div>
      </section>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        title="Supprimer ce projet ?"
        message={`« ${project.name} » et tous ses formulaires seront définitivement supprimés, avec leurs réponses.`}
        confirmLabel="Supprimer définitivement"
        variant="danger"
      />
    </div>
  );
}

export default function ProjectPage() {
  return (
    <Suspense fallback={null}>
      <ProjectWorkspace />
    </Suspense>
  );
}

// ============================================================================
// Devise et TVA du projet
// ============================================================================

/**
 * Réglages monétaires partagés par tous les formulaires du projet.
 *
 * Ils vivent ici et non sur chaque formulaire parce qu'un même événement facture
 * dans une seule monnaie : régler la devise vingt fois, c'est se tromper une
 * fois. Un formulaire peut tout de même la surcharger, depuis son propre onglet
 * de tarification, mais c'est alors un geste délibéré.
 */
function ProjectPricingSection({
  project,
  onChanged
}: {
  project: Project;
  onChanged: () => Promise<void>;
}) {
  const [pricing, setPricing] = useState<ProjectPricing>(project.pricing);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(pricing) !== JSON.stringify(project.pricing);

  const save = async () => {
    setSaving(true);
    try {
      await updateProject(project.id, { pricing });
      await onChanged();
      toast.success('Réglages enregistrés.');
    } catch (error) {
      console.error('Failed to save project pricing:', error);
      toast.error("L'enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-border bg-bg-surface p-6">
      <h2 className="font-display text-base font-bold text-text-primary">Devise et TVA</h2>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary">
        Repris par tous les formulaires du projet. Chacun peut les surcharger depuis son
        onglet Tarification.
      </p>

      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Devise"
            value={pricing.currency}
            onChange={(event) =>
              setPricing({ ...pricing, currency: event.target.value.toUpperCase().slice(0, 4) })
            }
          />
          <div className="space-y-1.5">
            <label htmlFor="project-currency-position" className="block text-sm text-text-secondary">
              Position du symbole
            </label>
            <select
              id="project-currency-position"
              value={pricing.currency_position}
              onChange={(event) =>
                setPricing({
                  ...pricing,
                  currency_position: event.target.value as 'before' | 'after'
                })
              }
              className="w-full rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-hidden"
            >
              <option value="before">
                Avant — {formatMoney(1500, pricing.currency, 'before')}
              </option>
              <option value="after">
                Après — {formatMoney(1500, pricing.currency, 'after')}
              </option>
            </select>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Switch
            checked={pricing.vat_enabled}
            onChange={(vat_enabled) => setPricing({ ...pricing, vat_enabled })}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-primary">Appliquer la TVA</p>
            {pricing.vat_enabled && (
              <div className="mt-2 max-w-[12rem]">
                <Input
                  label="Taux (%)"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={String(pricing.vat_rate)}
                  onChange={(event) =>
                    setPricing({ ...pricing, vat_rate: Number(event.target.value) || 0 })
                  }
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>
            Enregistrer
          </Button>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Numérotation des bons de commande
// ============================================================================

/**
 * La séquence des numéros de bon de commande.
 *
 * Elle est portée par le projet parce qu'elle appartient à un événement, pas à
 * l'un de ses formulaires : l'inscription en ligne et le bulletin papier saisi
 * à la main doivent tirer leurs numéros du même compteur.
 *
 * Le compteur lui-même n'est jamais écrit ici pendant une inscription : c'est
 * une fonction SQL qui l'incrémente, sous verrou de ligne, au moment où la
 * réponse est déjà enregistrée. Ce panneau ne sert qu'à choisir la forme du
 * numéro et son point de départ.
 */
function ProjectInvoicingSection({
  project,
  onChanged
}: {
  project: Project;
  onChanged: () => Promise<void>;
}) {
  const [invoicing, setInvoicing] = useState<ProjectInvoicing>(project.invoicing);
  const [enabled, setEnabled] = useState(project.modules.invoicing);
  const [saving, setSaving] = useState(false);

  const dirty =
    JSON.stringify(invoicing) !== JSON.stringify(project.invoicing) ||
    enabled !== project.modules.invoicing;

  const preview = `${invoicing.prefix || 'CMD'}-${String(invoicing.next).padStart(
    Math.min(8, Math.max(1, invoicing.pad)),
    '0'
  )}`;

  const save = async () => {
    setSaving(true);
    try {
      await updateProject(project.id, {
        invoicing,
        modules: { ...project.modules, invoicing: enabled }
      });
      await onChanged();
      toast.success('Numérotation enregistrée.');
    } catch (error) {
      console.error('Failed to save project invoicing:', error);
      toast.error("L'enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-border bg-bg-surface p-6">
      <h2 className="font-display text-base font-bold text-text-primary">
        Numérotation des bons de commande
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary">
        Chaque réponse aux formulaires du projet reçoit un numéro, tiré d&apos;une seule
        séquence.
      </p>

      <div className="mt-4 flex items-start gap-3">
        <Switch checked={enabled} onChange={setEnabled} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-text-primary">Attribuer un numéro à chaque réponse</p>
          <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
            Un sondage n&apos;en a pas besoin ; une inscription payante, si.
          </p>
        </div>
      </div>

      {enabled && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Préfixe"
              value={invoicing.prefix}
              maxLength={12}
              onChange={(event) =>
                setInvoicing({
                  ...invoicing,
                  prefix: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12)
                })
              }
            />
            <Input
              label="Chiffres"
              type="number"
              min={1}
              max={8}
              value={String(invoicing.pad)}
              onChange={(event) =>
                setInvoicing({
                  ...invoicing,
                  pad: Math.min(8, Math.max(1, Number(event.target.value) || 4))
                })
              }
            />
            <Input
              label="Prochain numéro"
              type="number"
              min={1}
              value={String(invoicing.next)}
              onChange={(event) =>
                setInvoicing({
                  ...invoicing,
                  next: Math.max(1, Math.floor(Number(event.target.value) || 1))
                })
              }
            />
          </div>

          <p className="text-sm text-text-secondary">
            La prochaine réponse portera le numéro{' '}
            <span className="font-mono font-semibold text-text-primary">{preview}</span>.
          </p>

          {invoicing.next < project.invoicing.next && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-relaxed text-text-primary">
              Reculer le compteur fera réattribuer des numéros déjà utilisés. Deux réponses
              porteraient alors la même référence, et rien ne les distinguerait.
            </p>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>
          Enregistrer
        </Button>
      </div>
    </section>
  );
}
