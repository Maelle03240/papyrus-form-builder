'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sheet,
  Trash2,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import type { Form, FormIntegration, GoogleSheetsConfig, IntegrationEvent } from '@/types';

/**
 * Onglet « Intégrations » d'un formulaire.
 *
 * Une seule intégration est réellement branchée — Google Sheets — et elle vaut
 * pour un formulaire, pas pour tout l'espace : deux formulaires du même espace
 * peuvent alimenter deux feuilles différentes. La connexion Google, elle, est
 * partagée par l'espace de travail : on ne redemande pas son consentement à
 * chaque formulaire.
 *
 * Les autres fournisseurs sont listés sans être cliquables. Les afficher indique
 * ce qui est prévu ; les rendre cliquables promettrait ce qui n'existe pas.
 */

interface GoogleStatus {
  connected: boolean;
  configured: boolean;
  email?: string | null;
  needsReconnect?: boolean;
}

interface SpreadsheetSummary {
  id: string;
  name: string;
  url: string;
}

const CALLBACK_MESSAGES: Record<string, { kind: 'success' | 'error'; text: string }> = {
  connected: { kind: 'success', text: 'Compte Google connecté.' },
  refused: { kind: 'error', text: "L'autorisation Google a été refusée." },
  invalid_state: {
    kind: 'error',
    text: "La demande d'autorisation a expiré. Relancez la connexion."
  },
  forbidden: { kind: 'error', text: "Vous n'êtes plus membre de cet espace de travail." },
  no_refresh_token: {
    kind: 'error',
    text: "Google n'a pas renvoyé de jeton durable. Retirez l'accès dans votre compte Google, puis reconnectez."
  },
  error: { kind: 'error', text: 'La connexion Google a échoué.' }
};

export function FormIntegrationsTab({ form }: { form: Form }) {
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [teamId, setTeamId] = useState<string>(form.team_id);
  const [google, setGoogle] = useState<GoogleStatus>({ connected: false, configured: false });
  const [integrations, setIntegrations] = useState<FormIntegration[]>([]);
  const [events, setEvents] = useState<IntegrationEvent[]>([]);

  const [showEditor, setShowEditor] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FormIntegration | null>(null);
  const [resyncing, setResyncing] = useState(false);

  const sheets = integrations.find((integration) => integration.provider === 'google_sheets') ?? null;

  const loadIntegrations = useCallback(async () => {
    try {
      const response = await fetch(`/api/forms/${form.id}/integrations`);
      if (!response.ok) throw new Error();
      const body = await response.json();
      setIntegrations(body.integrations ?? []);
      setEvents(body.events ?? []);
      if (body.teamId) setTeamId(body.teamId);
      return body.teamId as string | undefined;
    } catch {
      toast.error('Impossible de charger les intégrations de ce formulaire.');
      return undefined;
    }
  }, [form.id]);

  const loadGoogleStatus = useCallback(async (workspaceId: string) => {
    try {
      const response = await fetch(
        `/api/integrations/google/status?teamId=${encodeURIComponent(workspaceId)}`
      );
      if (!response.ok) throw new Error();
      setGoogle((await response.json()) as GoogleStatus);
    } catch {
      setGoogle({ connected: false, configured: false });
    }
  }, []);

  useEffect(() => {
    (async () => {
      const workspaceId = (await loadIntegrations()) ?? form.team_id;
      await loadGoogleStatus(workspaceId);
      setLoading(false);
    })();
  }, [loadIntegrations, loadGoogleStatus, form.team_id]);

  // Retour du consentement Google : /api/integrations/google/callback redirige
  // ici avec un paramètre décrivant l'issue.
  useEffect(() => {
    const outcome = searchParams.get('google');
    if (!outcome) return;

    const message = CALLBACK_MESSAGES[outcome];
    if (message) {
      if (message.kind === 'success') toast.success(message.text);
      else toast.error(message.text);
    }

    // Nettoie l'URL pour ne pas rejouer le message à chaque rendu.
    const url = new URL(window.location.href);
    url.searchParams.delete('google');
    window.history.replaceState({}, '', url.toString());

    if (outcome === 'connected') {
      loadGoogleStatus(form.team_id);
      setShowEditor(true);
    }
  }, [searchParams, loadGoogleStatus, form.team_id]);

  function connectGoogle() {
    const target = `/api/integrations/google/connect?teamId=${encodeURIComponent(
      teamId
    )}&formId=${encodeURIComponent(form.id)}`;
    window.location.href = target;
  }

  async function toggleIntegration(integration: FormIntegration, active: boolean) {
    // Bascule optimiste : l'interrupteur doit répondre à l'instant, l'appel
    // réseau n'est qu'une confirmation.
    setIntegrations((previous) =>
      previous.map((item) => (item.id === integration.id ? { ...item, is_active: active } : item))
    );

    try {
      const response = await fetch(`/api/forms/${form.id}/integrations`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: integration.id, is_active: active })
      });
      if (!response.ok) throw new Error();
      toast.success(active ? 'Synchronisation activée.' : 'Synchronisation suspendue.');
    } catch {
      setIntegrations((previous) =>
        previous.map((item) =>
          item.id === integration.id ? { ...item, is_active: !active } : item
        )
      );
      toast.error('Impossible de modifier cette intégration.');
    }
  }

  async function deleteIntegration(integration: FormIntegration) {
    setConfirmDelete(null);
    try {
      const response = await fetch(
        `/api/forms/${form.id}/integrations?integrationId=${encodeURIComponent(integration.id)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new Error();
      setIntegrations((previous) => previous.filter((item) => item.id !== integration.id));
      toast.success('Intégration supprimée. La feuille de calcul, elle, est intacte.');
    } catch {
      toast.error('Impossible de supprimer cette intégration.');
    }
  }

  async function resync() {
    setResyncing(true);
    try {
      const response = await fetch(`/api/forms/${form.id}/integrations/resync`, {
        method: 'POST'
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'La resynchronisation a échoué.');

      toast.success(
        `Feuille resynchronisée — ${body.rows} ligne${body.rows > 1 ? 's' : ''} écrite${
          body.rows > 1 ? 's' : ''
        }.`
      );
      await loadIntegrations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'La resynchronisation a échoué.');
    } finally {
      setResyncing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* ---- Connexions de ce formulaire ---- */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-xl">Mes connexions</h2>
          <p className="papyrus-meta mt-1 max-w-2xl text-sm">
            i. Les services reliés à ce formulaire. Chaque réponse enregistrée y est envoyée
            automatiquement ; l’historique conserve la trace de chaque envoi.
          </p>
        </div>

        {sheets ? (
          <IntegrationRow
            integration={sheets}
            onToggle={(active) => toggleIntegration(sheets, active)}
            onEdit={() => setShowEditor(true)}
            onHistory={() => setShowHistory(true)}
            onDelete={() => setConfirmDelete(sheets)}
            onResync={resync}
            resyncing={resyncing}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-border-strong bg-bg-surface p-8 text-center">
            <Sheet className="mx-auto h-8 w-8 text-text-tertiary" />
            <h3 className="mt-3 font-display text-lg">Aucune connexion pour l’instant</h3>
            <p className="papyrus-meta mx-auto mt-1 max-w-md text-sm">
              i. Reliez ce formulaire à une feuille Google Sheets pour y voir arriver les réponses
              en temps réel.
            </p>
          </div>
        )}
      </section>

      {/* ---- Fournisseurs disponibles ---- */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-xl">Découvrir les intégrations</h2>
          <p className="papyrus-meta mt-1 text-sm">
            i. Un seul service est branché pour le moment. Les autres sont listés pour ce qu’ils
            sont : prévus, pas encore disponibles.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ProviderCard
            name="Google Sheets"
            description="Envoie chaque réponse dans une feuille de calcul."
            icon={<Sheet className="h-5 w-5 text-emerald-600" />}
          >
            {!google.configured ? (
              <p className="text-xs text-warning">
                Non configuré sur cette instance (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
              </p>
            ) : google.connected && !google.needsReconnect ? (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {google.email ?? 'Compte Google connecté'}
                </p>
                <Button
                  size="sm"
                  variant={sheets ? 'secondary' : 'cta'}
                  iconLeft={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setShowEditor(true)}
                >
                  {sheets ? 'Modifier la feuille' : 'Choisir une feuille'}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {google.needsReconnect && (
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    La connexion enregistrée n’est plus utilisable. Reconnectez le compte.
                  </p>
                )}
                <Button size="sm" variant="cta" onClick={connectGoogle}>
                  Connecter
                </Button>
              </div>
            )}
          </ProviderCard>

          {[
            { name: 'Webhooks', description: 'Poste chaque réponse vers votre propre endpoint.' },
            { name: 'Notion', description: 'Crée une page par réponse dans une base Notion.' },
            { name: 'Airtable', description: 'Ajoute une ligne dans une table Airtable.' },
            { name: 'Slack', description: 'Publie un message à chaque nouvelle réponse.' },
            { name: 'Zapier', description: 'Relaie les réponses vers vos automatisations.' }
          ].map((provider) => (
            <ProviderCard
              key={provider.name}
              name={provider.name}
              description={provider.description}
              muted
            >
              <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-text-tertiary">
                bientôt
              </span>
            </ProviderCard>
          ))}
        </div>
      </section>

      {showEditor && (
        <GoogleSheetsEditor
          form={form}
          teamId={teamId}
          existing={sheets}
          onClose={() => setShowEditor(false)}
          onSaved={async () => {
            setShowEditor(false);
            await loadIntegrations();
          }}
        />
      )}

      {showHistory && (
        <HistoryPanel events={events} onClose={() => setShowHistory(false)} />
      )}

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteIntegration(confirmDelete)}
        title="Supprimer cette intégration ?"
        message="Les réponses à venir ne seront plus envoyées vers la feuille. Les lignes déjà écrites y restent."
        confirmLabel="Supprimer"
      />
    </div>
  );
}

// ============================================================================
// Ligne d'une intégration active
// ============================================================================

function IntegrationRow({
  integration,
  onToggle,
  onEdit,
  onHistory,
  onDelete,
  onResync,
  resyncing
}: {
  integration: FormIntegration;
  onToggle: (active: boolean) => void;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
  onResync: () => void;
  resyncing: boolean;
}) {
  const config = integration.config as GoogleSheetsConfig;

  return (
    <div className="rounded-2xl border border-border bg-bg-surface p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
            <Sheet className="h-4.5 w-4.5 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-display text-base font-bold text-text-primary">
                {config.spreadsheet_name || 'Feuille Google Sheets'}
              </h3>
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  integration.is_active ? 'bg-success' : 'bg-text-tertiary/40'
                )}
                title={integration.is_active ? 'Synchronisation active' : 'Synchronisation suspendue'}
              />
            </div>
            <p className="mt-0.5 text-sm text-text-secondary">
              Onglet <span className="font-medium">{config.sheet_title}</span>
              {config.spreadsheet_url && (
                <>
                  {' · '}
                  <a
                    href={config.spreadsheet_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    Ouvrir la feuille
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              {integration.last_synced_at
                ? `Dernière synchronisation le ${new Date(
                    integration.last_synced_at
                  ).toLocaleString('fr-FR')}`
                : 'Aucune synchronisation pour l’instant'}
            </p>
            {integration.last_error && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/5 px-2.5 py-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {integration.last_error}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Switch checked={integration.is_active} onChange={onToggle} />
          <IconButton label="Historique des synchronisations" onClick={onHistory}>
            <Clock className="h-4 w-4" />
          </IconButton>
          <IconButton label="Resynchroniser toutes les réponses" onClick={onResync} busy={resyncing}>
            <RefreshCw className={cn('h-4 w-4', resyncing && 'animate-spin')} />
          </IconButton>
          <IconButton label="Modifier" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton label="Supprimer" onClick={onDelete} danger>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  danger,
  busy
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={busy}
      className={cn(
        'rounded-lg p-2 transition disabled:opacity-50',
        danger
          ? 'text-text-tertiary hover:bg-danger/10 hover:text-danger'
          : 'text-text-tertiary hover:bg-bg-elevated hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}

function ProviderCard({
  name,
  description,
  icon,
  muted,
  children
}: {
  name: string;
  description: string;
  icon?: React.ReactNode;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-4',
        muted && 'opacity-70'
      )}
    >
      <div className="flex items-center gap-2.5">
        {icon ?? <div className="h-5 w-5 rounded bg-text-tertiary/20" />}
        <h3 className="font-display text-base font-bold text-text-primary">{name}</h3>
      </div>
      <p className="flex-1 text-sm text-text-secondary">{description}</p>
      <div>{children}</div>
    </div>
  );
}

// ============================================================================
// Historique des synchronisations
// ============================================================================

function HistoryPanel({
  events,
  onClose
}: {
  events: IntegrationEvent[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Historique des synchronisations"
        className="relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-display text-lg font-bold">Historique des synchronisations</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-tertiary hover:bg-bg-elevated hover:text-text-primary"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-tertiary">
              Aucun évènement enregistré pour l’instant.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {events.map((event) => (
                <li key={event.id} className="flex items-start gap-3 py-3">
                  <span
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      event.status === 'success'
                        ? 'bg-success'
                        : event.status === 'error'
                          ? 'bg-danger'
                          : 'bg-text-tertiary/50'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary">
                      {event.message ?? (event.status === 'success' ? 'Synchronisé' : 'Échec')}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-text-tertiary">
                      {new Date(event.created_at).toLocaleString('fr-FR')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Choix de la feuille de calcul
// ============================================================================

function GoogleSheetsEditor({
  form,
  teamId,
  existing,
  onClose,
  onSaved
}: {
  form: Form;
  teamId: string;
  existing: FormIntegration | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const current = (existing?.config ?? {}) as Partial<GoogleSheetsConfig>;

  const [mode, setMode] = useState<'existing' | 'create' | 'link'>(
    existing ? 'existing' : 'create'
  );
  const [spreadsheets, setSpreadsheets] = useState<SpreadsheetSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedId, setSelectedId] = useState(current.spreadsheet_id ?? '');
  const [selectedName, setSelectedName] = useState(current.spreadsheet_name ?? '');
  const [selectedUrl, setSelectedUrl] = useState(current.spreadsheet_url ?? '');
  const [sheetTitle, setSheetTitle] = useState(current.sheet_title ?? 'Réponses');
  const [includeMetadata, setIncludeMetadata] = useState(current.include_metadata !== false);

  const [newTitle, setNewTitle] = useState(`${form.title} — réponses`);
  const [linkInput, setLinkInput] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(
          `/api/integrations/google/spreadsheets?teamId=${encodeURIComponent(teamId)}`
        );
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? 'Chargement impossible.');
        setSpreadsheets(body.spreadsheets ?? []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Chargement impossible.');
      } finally {
        setLoadingList(false);
      }
    })();
  }, [teamId]);

  async function lookupByLink() {
    if (!linkInput.trim()) return;
    try {
      const response = await fetch(
        `/api/integrations/google/spreadsheets?teamId=${encodeURIComponent(
          teamId
        )}&lookup=${encodeURIComponent(linkInput.trim())}`
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'Feuille introuvable.');

      setSelectedId(body.spreadsheet.id);
      setSelectedName(body.spreadsheet.name);
      setSelectedUrl(body.spreadsheet.url);
      if (body.spreadsheet.sheets?.length > 0) setSheetTitle(body.spreadsheet.sheets[0]);
      toast.success(`« ${body.spreadsheet.name} » rattachée.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Feuille introuvable.');
    }
  }

  async function save() {
    setSaving(true);
    try {
      let spreadsheetId = selectedId;
      let spreadsheetName = selectedName;
      let spreadsheetUrl = selectedUrl;
      let targetSheet = sheetTitle.trim() || 'Réponses';

      if (mode === 'create') {
        const response = await fetch('/api/integrations/google/spreadsheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teamId,
            title: newTitle.trim() || `${form.title} — réponses`,
            sheetTitle: targetSheet
          })
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? 'Création impossible.');

        spreadsheetId = body.spreadsheet.id;
        spreadsheetName = body.spreadsheet.name;
        spreadsheetUrl = body.spreadsheet.url;
        targetSheet = body.spreadsheet.sheets?.[0] ?? targetSheet;
      }

      if (!spreadsheetId) {
        throw new Error('Choisissez une feuille de calcul.');
      }

      const response = await fetch(`/api/forms/${form.id}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google_sheets',
          is_active: true,
          config: {
            spreadsheet_id: spreadsheetId,
            spreadsheet_name: spreadsheetName || undefined,
            spreadsheet_url: spreadsheetUrl || undefined,
            sheet_title: targetSheet,
            include_metadata: includeMetadata
          }
        })
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'Enregistrement impossible.');

      toast.success('Feuille reliée. Les prochaines réponses y seront ajoutées.');
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Relier une feuille Google Sheets"
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-display text-lg font-bold">Feuille de destination</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-tertiary hover:bg-bg-elevated hover:text-text-primary"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="flex gap-1 rounded-xl border border-border p-1">
            {(
              [
                ['create', 'Nouvelle feuille'],
                ['existing', 'Feuille existante'],
                ['link', 'Par lien']
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  'flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition',
                  mode === value
                    ? 'bg-mooove-navy text-mooove-ice'
                    : 'text-text-secondary hover:bg-bg-elevated'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'create' && (
            <label className="block">
              <span className="mb-1.5 block text-sm text-text-secondary">
                Nom de la feuille à créer
              </span>
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-bg-base px-3 text-sm text-text-primary focus:border-accent-cta focus:outline-none"
              />
              <span className="mt-1.5 block text-xs text-text-tertiary">
                Elle sera créée dans le Drive du compte Google connecté.
              </span>
            </label>
          )}

          {mode === 'existing' && (
            <div className="space-y-2">
              {loadingList ? (
                <p className="py-6 text-center text-sm text-text-tertiary">Chargement…</p>
              ) : spreadsheets.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-tertiary">
                  Aucune feuille créée depuis Papyrus. Créez-en une, ou rattachez-en une par son
                  lien.
                </p>
              ) : (
                <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                  {spreadsheets.map((spreadsheet) => (
                    <li key={spreadsheet.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(spreadsheet.id);
                          setSelectedName(spreadsheet.name);
                          setSelectedUrl(spreadsheet.url);
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition',
                          selectedId === spreadsheet.id
                            ? 'bg-accent-cta/10 text-text-primary'
                            : 'hover:bg-bg-elevated'
                        )}
                      >
                        <span className="truncate">{spreadsheet.name}</span>
                        {selectedId === spreadsheet.id && (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-text-tertiary">
                i. Seules les feuilles créées depuis Papyrus apparaissent ici : l’autorisation
                demandée à Google ne donne pas accès au reste de votre Drive.
              </p>
            </div>
          )}

          {mode === 'link' && (
            <div className="space-y-2">
              <label className="block">
                <span className="mb-1.5 block text-sm text-text-secondary">
                  Lien de la feuille
                </span>
                <div className="flex gap-2">
                  <input
                    value={linkInput}
                    onChange={(event) => setLinkInput(event.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    className="h-9 flex-1 rounded-md border border-border-strong bg-bg-base px-3 text-sm text-text-primary focus:border-accent-cta focus:outline-none"
                  />
                  <Button size="sm" variant="secondary" onClick={lookupByLink}>
                    Vérifier
                  </Button>
                </div>
              </label>
              {selectedName && (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {selectedName}
                </p>
              )}
            </div>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm text-text-secondary">Onglet</span>
            <input
              value={sheetTitle}
              onChange={(event) => setSheetTitle(event.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-bg-base px-3 text-sm text-text-primary focus:border-accent-cta focus:outline-none"
            />
            <span className="mt-1.5 block text-xs text-text-tertiary">
              Créé s’il n’existe pas. La première ligne accueille les intitulés des questions.
            </span>
          </label>

          <Switch
            checked={includeMetadata}
            onChange={setIncludeMetadata}
            label="Ajouter les colonnes techniques"
            description="Date de soumission, langue et identifiant de la réponse, en tête de ligne."
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="cta"
            loading={saving}
            disabled={mode !== 'create' && !selectedId}
            onClick={save}
          >
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}
