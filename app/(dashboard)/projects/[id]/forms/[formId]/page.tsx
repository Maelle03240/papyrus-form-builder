'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  BarChart3,
  CreditCard,
  ListChecks,
  Mail,
  Palette,
  Plug,
  Settings as SettingsIcon,
  Share2,
  Wrench
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { WorkspaceTabs, SubTabs, type TabItem } from '@/components/dashboard/WorkspaceTabs';
import { FormBuilder } from '@/components/builder/FormBuilder';
import { FormDesignPanel } from '@/components/builder/FormDesignPanel';
import { FormShareTab } from '@/components/dashboard/FormShareTab';
import { FormIntegrationsTab } from '@/components/dashboard/FormIntegrationsTab';
import { FormSettingsTab } from '@/components/dashboard/FormSettingsTab';
import { FormInsightsTab } from '@/components/dashboard/FormInsightsTab';
import { FormRecordsTab } from '@/components/dashboard/FormRecordsTab';
import { FormPricingTab } from '@/components/dashboard/FormPricingTab';
import { FormEmailTab } from '@/components/dashboard/FormEmailTab';
import { getProject, getForm, updateForm } from '@/lib/store';
import { createClient } from '@/lib/supabase/client';
import type { DisplayMode, Form, FormTheme, Project } from '@/types';

/**
 * Espace de travail d'un formulaire.
 *
 * L'arborescence reprend celle de mooove-invoice : quatre onglets principaux, et
 * la configuration regroupée sous « Setup ». Elle est portée par l'URL —
 * `?tab=setup&sub=design` — pour qu'un onglet se partage et que le bouton
 * « Précédent » du navigateur fonctionne.
 */

type Tab = 'setup' | 'records' | 'insights' | 'share';
type SubTab = 'build' | 'design' | 'pricing' | 'email' | 'integrations' | 'settings';

const TABS: Tab[] = ['setup', 'records', 'insights', 'share'];
const SUB_TABS: SubTab[] = ['build', 'design', 'pricing', 'email', 'integrations', 'settings'];

function FormWorkspace() {
  const params = useParams<{ id: string; formId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const requestedTab = searchParams.get('tab');
  const requestedSub = searchParams.get('sub');
  const tab: Tab = TABS.includes(requestedTab as Tab) ? (requestedTab as Tab) : 'setup';
  const sub: SubTab = SUB_TABS.includes(requestedSub as SubTab) ? (requestedSub as SubTab) : 'build';

  const [project, setProject] = useState<Project | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, unknown>[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [loadedProject, loadedForm] = await Promise.all([
        getProject(params.id),
        getForm(params.formId)
      ]);
      setProject(loadedProject);
      setForm(loadedForm);
    } catch (error) {
      console.error('Failed to load form workspace:', error);
      toast.error("Le formulaire n'a pas pu être chargé.");
    } finally {
      setLoading(false);
    }
  }, [params.id, params.formId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Les réponses ne sont chargées que pour les onglets qui les affichent.
   *
   * Sans cette garde, ouvrir le constructeur déclencherait la lecture de toutes
   * les réponses du formulaire, qui ne sert à rien pour éditer des questions.
   */
  const needsSubmissions = tab === 'records' || tab === 'insights';

  useEffect(() => {
    if (!needsSubmissions) return;

    let cancelled = false;
    (async () => {
      setSubmissionsLoading(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('submissions')
          .select('*')
          .eq('form_id', params.formId)
          .order('completed_at', { ascending: false });
        if (error) throw error;
        if (!cancelled) setSubmissions(data ?? []);
      } catch (error) {
        console.error('Failed to load submissions:', error);
        if (!cancelled) toast.error("Les réponses n'ont pas pu être chargées.");
      } finally {
        if (!cancelled) setSubmissionsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsSubmissions, params.formId]);

  const completed = useMemo(
    () => submissions.filter((row) => !(row as { is_partial?: boolean }).is_partial),
    [submissions]
  );

  const base = `/projects/${params.id}/forms/${params.formId}`;

  const tabs: TabItem[] = useMemo(
    () => [
      { key: 'setup', label: 'Configuration', href: base, icon: Wrench },
      { key: 'records', label: 'Réponses', href: `${base}?tab=records`, icon: ListChecks },
      { key: 'insights', label: 'Analyse', href: `${base}?tab=insights`, icon: BarChart3 },
      { key: 'share', label: 'Partage', href: `${base}?tab=share`, icon: Share2 }
    ],
    [base]
  );

  const subTabs: TabItem[] = useMemo(
    () => [
      { key: 'build', label: 'Questions', href: `${base}?tab=setup&sub=build`, icon: Wrench },
      { key: 'design', label: 'Apparence', href: `${base}?tab=setup&sub=design`, icon: Palette },
      {
        key: 'pricing',
        label: 'Tarification',
        href: `${base}?tab=setup&sub=pricing`,
        icon: CreditCard
      },
      { key: 'email', label: 'E-mails', href: `${base}?tab=setup&sub=email`, icon: Mail },
      {
        key: 'integrations',
        label: 'Intégrations',
        href: `${base}?tab=setup&sub=integrations`,
        icon: Plug
      },
      {
        key: 'settings',
        label: 'Paramètres',
        href: `${base}?tab=setup&sub=settings`,
        icon: SettingsIcon
      }
    ],
    [base]
  );

  const patchTheme = useCallback(
    async (patch: Partial<FormTheme>) => {
      if (!form) return;
      const next = { ...form, theme: { ...form.theme, ...patch } };
      setForm(next);
      await updateForm(form.id, { theme: next.theme });
    },
    [form]
  );

  const patchForm = useCallback(
    async (patch: Partial<Form>) => {
      if (!form) return;
      setForm({ ...form, ...patch });
      await updateForm(form.id, patch);
    },
    [form]
  );

  if (loading) {
    return (
      <div className="px-6 py-10" aria-busy="true">
        <div className="h-7 w-64 animate-pulse rounded-md bg-bg-elevated" />
        <div className="mt-8 h-64 animate-pulse rounded-xl bg-bg-elevated" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center">
        <h1 className="font-display text-lg font-bold text-text-primary">Formulaire introuvable</h1>
        <Button className="mt-6" variant="secondary" onClick={() => router.push(`/projects/${params.id}`)}>
          Revenir au projet
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-6 pt-6">
        <nav className="flex items-center gap-1.5 text-xs text-text-tertiary" aria-label="Fil d'Ariane">
          <Link href="/projects" className="transition hover:text-text-secondary">
            Projets
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/projects/${params.id}`} className="truncate transition hover:text-text-secondary">
            {project?.name ?? 'Projet'}
          </Link>
        </nav>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-xl font-bold text-text-primary">
            {form.title || 'Formulaire sans titre'}
          </h1>
          <Badge variant={form.status}>
            {form.status === 'published' ? 'Publié' : form.status === 'closed' ? 'Clos' : 'Brouillon'}
          </Badge>
        </div>
      </header>

      <div className="mt-5 shrink-0">
        <WorkspaceTabs items={tabs} active={tab} />
        {tab === 'setup' && <SubTabs items={subTabs} active={sub} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'setup' && sub === 'build' && (
          <div className="h-full">
            <FormBuilder
              formId={form.id}
              backHref={`/projects/${params.id}`}
              sharePath={`${base}?tab=share`}
              showBackButton={false}
            />
          </div>
        )}

        {tab === 'setup' && sub === 'design' && (
          <div className="mx-auto w-full max-w-xl px-6 py-8">
            <FormDesignPanel
              form={form}
              onChange={(patch) => void patchTheme(patch)}
              onFormChange={(patch) => void patchForm(patch)}
              onModeChange={(mode: DisplayMode) => void patchForm({ display_mode: mode })}
            />
          </div>
        )}

        {tab === 'setup' && sub === 'pricing' && (
          <FormPricingTab
            form={form}
            onChange={(patch) => void patchForm(patch)}
            buildHref={`${base}?tab=setup&sub=build`}
          />
        )}

        {tab === 'setup' && sub === 'email' && (
          <FormEmailTab
            form={form}
            project={project}
            buildHref={`${base}?tab=setup&sub=build`}
            projectSettingsHref={`/projects/${params.id}?tab=settings`}
            onSaved={(patch) => setForm((current) => (current ? { ...current, ...patch } : current))}
          />
        )}

        {tab === 'setup' && sub === 'integrations' && (
          <div className="px-6 py-8">
            <FormIntegrationsTab form={form} />
          </div>
        )}

        {tab === 'setup' && sub === 'settings' && (
          <div className="px-6 py-8">
            <FormSettingsTab form={form} />
          </div>
        )}

        {tab === 'records' && (
          <FormRecordsTab
            form={form}
            submissions={submissions}
            setSubmissions={setSubmissions}
            loading={submissionsLoading}
          />
        )}

        {tab === 'insights' && (
          <FormInsightsTab form={form} submissions={completed} loading={submissionsLoading} />
        )}

        {tab === 'share' && (
          <div className="px-6 py-8">
            <FormShareTab form={form} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function FormWorkspacePage() {
  return (
    <Suspense fallback={null}>
      <FormWorkspace />
    </Suspense>
  );
}
