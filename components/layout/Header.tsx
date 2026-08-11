'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useForm } from '@/lib/store/use-forms';

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  forms: 'Formulaires',
  templates: 'Modèles',
  settings: 'Paramètres',
  edit: 'Édition',
  share: 'Partage',
  responses: 'Réponses',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Renders the workspace + form title segments when a form UUID is detected in the path.
 * Replaces the raw UUID with: [workspace name] > [form title]
 */
function FormBreadcrumbSegments({
  formId,
  remainingSegments,
  formPath,
}: {
  formId: string;
  remainingSegments: string[];
  formPath: string;
}) {
  const { form, loading } = useForm(formId);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    // L'espace de travail d'un formulaire, c'est son `team_id`.
    const workspace = form?.team_id;
    if (!workspace) return;

    let cancelled = false;

    fetch('/api/teams')
      .then((response) => (response.ok ? response.json() : []))
      .then((teams: { id: string; name: string }[]) => {
        if (cancelled) return;
        const found = teams.find((team) => team.id === workspace);
        if (found) {
          setWorkspaceName(found.name || 'Mon espace');
          setWorkspaceId(workspace);
        }
      })
      .catch(() => {
        // Un fil d'Ariane incomplet ne doit pas casser la page.
      });

    return () => {
      cancelled = true;
    };
  }, [form]);

  const formTitle = loading ? '…' : (form?.title || 'Sans titre');
  const hasMore = remainingSegments.length > 0;

  return (
    <>
      {/* Workspace segment — always a link, the user is never "on" the workspace page here */}
      {workspaceName && (
        <span className="flex items-center gap-1.5 min-w-0">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <Link
            href={workspaceId ? `/forms?workspace=${workspaceId}` : '/forms'}
            className="text-text-secondary hover:text-text-primary transition-colors max-w-[140px] truncate"
          >
            {workspaceName}
          </Link>
        </span>
      )}

      {/* Form title segment */}
      <span className="flex items-center gap-1.5 min-w-0">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        {hasMore ? (
          <Link
            href={formPath}
            className="text-text-secondary hover:text-text-primary transition-colors max-w-[180px] truncate"
          >
            {formTitle}
          </Link>
        ) : (
          <span className="text-text-primary max-w-[180px] truncate">{formTitle}</span>
        )}
      </span>

      {/* Remaining segments (e.g. "edit", "share") */}
      {remainingSegments.map((seg, idx) => {
        const label = LABELS[seg] ?? seg;
        const isLast = idx === remainingSegments.length - 1;
        const segPath = `${formPath}/${remainingSegments.slice(0, idx + 1).join('/')}`;
        return (
          <span key={seg} className="flex items-center gap-1.5 min-w-0">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            {isLast ? (
              <span className="text-text-primary">{label}</span>
            ) : (
              <Link href={segPath} className="text-text-secondary hover:text-text-primary transition-colors">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </>
  );
}

export function Header() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  // Detect form UUID position: segment preceded by "forms"
  const formIdIndex = segments.findIndex(
    (seg, i) => UUID_REGEX.test(seg) && i > 0 && segments[i - 1] === 'forms'
  );

  const hasFormId = formIdIndex !== -1;

  if (hasFormId) {
    // Segments before the form ID (e.g. ["forms"])
    const before = segments.slice(0, formIdIndex);
    const formId = segments[formIdIndex];
    const formPath = '/' + segments.slice(0, formIdIndex + 1).join('/');
    // Segments after the form ID (e.g. ["edit"])
    const after = segments.slice(formIdIndex + 1);

    return (
      <header className="flex h-14 items-center border-b border-border bg-bg-base px-8">
        <nav className="flex items-center gap-1.5 text-sm min-w-0">
          {before.map((seg, i) => {
            const label = LABELS[seg] ?? seg;
            const path = '/' + segments.slice(0, i + 1).join('/');
            return (
              <span key={i} className="flex items-center gap-1.5 min-w-0">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />}
                <Link href={path} className="text-text-secondary hover:text-text-primary transition-colors">
                  {label}
                </Link>
              </span>
            );
          })}
          <FormBreadcrumbSegments
            formId={formId}
            remainingSegments={after}
            formPath={formPath}
          />
        </nav>
      </header>
    );
  }

  // Default breadcrumb for non-form paths
  const buildPath = (index: number) => '/' + segments.slice(0, index + 1).join('/');

  return (
    <header className="flex h-14 items-center border-b border-border bg-bg-base px-8">
      <nav className="flex items-center gap-1.5 text-sm min-w-0">
        {segments.length === 0 && <span className="text-text-primary">Accueil</span>}
        {segments.map((seg, i) => {
          const label = LABELS[seg] ?? seg;
          const isLast = i === segments.length - 1;
          const path = buildPath(i);
          return (
            <span key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />}
              {isLast ? (
                <span className="text-text-primary">{label}</span>
              ) : (
                <Link href={path} className="text-text-secondary hover:text-text-primary transition-colors">
                  {label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
    </header>
  );
}