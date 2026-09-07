'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Download, KeyRound, Link2, Plug, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { getWorkspaces } from '@/lib/store/workspaces';
import type { Workspace } from '@/types';

interface CredentialState {
  connected: boolean;
  maskedKey?: string | null;
  needsReconnect?: boolean;
  updatedAt?: string | null;
}

interface TallyForm {
  id: string;
  name: string;
  status: string | null;
  submissions: number | null;
}

interface ImportResult {
  formId: string;
  formTitle: string;
  fieldsImported: number;
  responsesImported: number;
  warnings: string[];
}

/**
 * Paramètres › Intégrations — import depuis Tally.
 *
 * Deux chemins, selon ce dont dispose l'utilisateur :
 *  · avec une clé API : la liste de ses formulaires Tally s'affiche et l'import
 *    embarque les réponses déjà collectées ;
 *  · sans clé : coller un lien tally.so importe la structure du formulaire.
 */
export default function IntegrationsPage() {
  const router = useRouter();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [teamId, setTeamId] = useState<string>('');
  const [credential, setCredential] = useState<CredentialState>({ connected: false });
  const [loading, setLoading] = useState(true);

  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const [tallyForms, setTallyForms] = useState<TallyForm[]>([]);
  const [loadingForms, setLoadingForms] = useState(false);

  const [linkDraft, setLinkDraft] = useState('');
  const [importResponses, setImportResponses] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  // Charger les espaces de travail, puis la connexion Tally du premier.
  useEffect(() => {
    (async () => {
      try {
        const list = await getWorkspaces();
        setWorkspaces(list);
        if (list.length > 0) setTeamId(list[0].id);
      } catch {
        toast.error('Impossible de charger vos espaces de travail.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadCredential = useCallback(async (workspaceId: string) => {
    if (!workspaceId) return;
    try {
      const response = await fetch(
        `/api/integrations/tally/credentials?teamId=${encodeURIComponent(workspaceId)}`
      );
      if (response.status === 403) {
        setCredential({ connected: false });
        return;
      }
      if (!response.ok) throw new Error();
      setCredential((await response.json()) as CredentialState);
    } catch {
      setCredential({ connected: false });
    }
  }, []);

  useEffect(() => {
    loadCredential(teamId);
    setTallyForms([]);
  }, [teamId, loadCredential]);

  async function handleSaveKey(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKeyDraft.trim() || !teamId) return;

    setSavingKey(true);
    try {
      const response = await fetch('/api/integrations/tally/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, apiKey: apiKeyDraft.trim() })
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'Connexion refusée.');

      setCredential(body as CredentialState);
      setApiKeyDraft('');
      toast.success(
        typeof body.formCount === 'number'
          ? `Tally connecté — ${body.formCount} formulaire${body.formCount > 1 ? 's' : ''} accessible${body.formCount > 1 ? 's' : ''}.`
          : 'Tally connecté.'
      );
      loadTallyForms();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Connexion refusée.');
    } finally {
      setSavingKey(false);
    }
  }

  async function handleDisconnect() {
    setConfirmDisconnect(false);
    setDisconnecting(true);
    try {
      const response = await fetch('/api/integrations/tally/credentials', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId })
      });
      if (!response.ok) throw new Error();
      setCredential({ connected: false });
      setTallyForms([]);
      toast.success('Tally déconnecté.');
    } catch {
      toast.error('Impossible de déconnecter Tally.');
    } finally {
      setDisconnecting(false);
    }
  }

  const loadTallyForms = useCallback(async () => {
    if (!teamId) return;
    setLoadingForms(true);
    try {
      const response = await fetch(
        `/api/integrations/tally/forms?teamId=${encodeURIComponent(teamId)}`
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'Chargement impossible.');
      setTallyForms(body.forms ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Chargement impossible.');
    } finally {
      setLoadingForms(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (credential.connected && !credential.needsReconnect) loadTallyForms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential.connected, credential.needsReconnect]);

  async function runImport(source: string, label: string) {
    if (!teamId) return;

    setImporting(source);
    setLastResult(null);

    try {
      const response = await fetch('/api/integrations/tally/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, source, importResponses })
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "L'import a échoué.");

      setLastResult(body as ImportResult);
      toast.success(`« ${label} » importé.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "L'import a échoué.");
    } finally {
      setImporting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-accent-cta" />
          <h2 className="font-display text-2xl font-bold">Intégrations</h2>
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          Reprenez vos formulaires Tally — structure et réponses — dans Papyrus.
        </p>
      </header>

      {/* Espace de destination */}
      {workspaces.length > 1 && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-primary">
            Espace de destination
          </span>
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="h-11 w-full max-w-sm rounded-xl border border-border-strong bg-bg-base px-3 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* --- Connexion Tally --- */}
      <section className="space-y-4 rounded-2xl border border-border bg-bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg font-bold">
              <KeyRound className="h-4 w-4 text-text-secondary" />
              Clé API Tally
            </h3>
            <p className="mt-1 text-sm text-text-secondary">
              Nécessaire pour importer les <strong>réponses déjà collectées</strong>. À créer
              dans Tally › Settings › API.
            </p>
          </div>

          {credential.connected && !credential.needsReconnect && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connecté
            </span>
          )}
        </div>

        {credential.needsReconnect && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              La clé enregistrée ne peut plus être déchiffrée (la clé de chiffrement de
              l&apos;application a changé). Saisissez-la à nouveau.
            </span>
          </div>
        )}

        {credential.connected && !credential.needsReconnect ? (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-bg-base/40 px-4 py-3">
            <span className="font-mono text-sm text-text-secondary">{credential.maskedKey}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDisconnect(true)}
              loading={disconnecting}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Déconnecter
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSaveKey} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                type="password"
                label="Clé API"
                placeholder="tly-••••••••••••••••"
                autoComplete="off"
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                hint="Chiffrée avant enregistrement, jamais réaffichée en clair."
              />
            </div>
            <Button type="submit" variant="cta" loading={savingKey} disabled={!apiKeyDraft.trim()}>
              Connecter
            </Button>
          </form>
        )}
      </section>

      {/* --- Import par lien public --- */}
      <section className="space-y-4 rounded-2xl border border-border bg-bg-surface p-6">
        <div>
          <h3 className="flex items-center gap-2 font-display text-lg font-bold">
            <Link2 className="h-4 w-4 text-text-secondary" />
            Importer depuis un lien
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Collez l&apos;URL d&apos;un formulaire Tally —{' '}
            <code className="font-mono text-xs">tally.so/r/wA5bEq</code> — ou son identifiant.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (linkDraft.trim()) runImport(linkDraft.trim(), linkDraft.trim());
          }}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <Input
              label="Lien Tally"
              placeholder="https://tally.so/r/wA5bEq"
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="cta"
            loading={importing === linkDraft.trim()}
            disabled={!linkDraft.trim() || !teamId}
          >
            <Download className="mr-1 h-4 w-4" />
            Importer
          </Button>
        </form>

        <Switch
          checked={importResponses}
          onChange={setImportResponses}
          label="Importer aussi les réponses"
          description="Nécessite une clé API connectée. Sans clé, seule la structure du formulaire est reprise."
        />
      </section>

      {/* --- Vos formulaires Tally --- */}
      {credential.connected && !credential.needsReconnect && (
        <section className="space-y-4 rounded-2xl border border-border bg-bg-surface p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-bold">Vos formulaires Tally</h3>
            <Button variant="ghost" size="sm" onClick={loadTallyForms} loading={loadingForms}>
              Actualiser
            </Button>
          </div>

          {loadingForms ? (
            <p className="py-6 text-center text-sm text-text-tertiary">Chargement…</p>
          ) : tallyForms.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-tertiary">
              Aucun formulaire accessible avec cette clé.
            </p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {tallyForms.map((form) => (
                <li key={form.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">{form.name}</p>
                    <p className="text-xs text-text-tertiary">
                      {form.submissions !== null
                        ? `${form.submissions} réponse${form.submissions > 1 ? 's' : ''}`
                        : 'Réponses inconnues'}
                      {form.status ? ` · ${form.status.toLowerCase()}` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={importing === form.id}
                    disabled={importing !== null}
                    onClick={() => runImport(form.id, form.name)}
                  >
                    <Download className="mr-1 h-4 w-4" />
                    Importer
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* --- Résultat du dernier import --- */}
      {lastResult && (
        <section className="space-y-3 rounded-2xl border border-success/30 bg-success/5 p-6">
          <h3 className="flex items-center gap-2 font-display text-lg font-bold">
            <CheckCircle2 className="h-5 w-5 text-success" />
            « {lastResult.formTitle} » importé
          </h3>
          <p className="text-sm text-text-secondary">
            {lastResult.fieldsImported} question{lastResult.fieldsImported > 1 ? 's' : ''} ·{' '}
            {lastResult.responsesImported} réponse{lastResult.responsesImported > 1 ? 's' : ''}.
            Le formulaire est créé en brouillon.
          </p>

          {lastResult.warnings.length > 0 && (
            <ul className="space-y-1.5 border-t border-success/20 pt-3 text-sm text-text-secondary">
              {lastResult.warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}

          <Button size="sm" onClick={() => router.push(`/forms/${lastResult.formId}/edit`)}>
            Ouvrir dans le builder
          </Button>
        </section>
      )}

      <ConfirmDialog
        isOpen={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={handleDisconnect}
        title="Déconnecter Tally ?"
        message="La clé API sera supprimée. Les formulaires déjà importés restent dans Papyrus."
        confirmLabel="Déconnecter"
      />
    </div>
  );
}
