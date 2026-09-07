'use client';

import { useCallback, useEffect, useState } from 'react';
import { Globe, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/Toast';

interface AccessSettings {
  isAppAdmin: boolean;
  allowedEmailDomains: string[];
  allowPublicSignup: boolean;
  updatedAt: string | null;
}

/**
 * Administration — qui a le droit de rejoindre cet espace Papyrus.
 *
 * Google connecte n'importe quel compte Google : cette liste est ce qui rend le
 * bouton « Se connecter avec Google » utilisable en entreprise. Elle est
 * appliquée côté serveur au retour du callback OAuth ; cet écran ne fait que
 * l'éditer.
 */
export default function AccessSettingsPage() {
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [domainDraft, setDomainDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/settings');
      if (!response.ok) throw new Error('load_failed');
      setSettings((await response.json()) as AccessSettings);
    } catch {
      toast.error('Impossible de charger les réglages d’accès.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function persist(patch: Partial<Pick<AccessSettings, 'allowedEmailDomains' | 'allowPublicSignup'>>) {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'Échec de l’enregistrement.');

      setSettings((current) => (current ? { ...current, ...body } : current));
      toast.success('Réglages enregistrés.');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Échec de l’enregistrement.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;

    const candidate = domainDraft.trim();
    if (!candidate) return;

    if (settings.allowedEmailDomains.includes(candidate.toLowerCase().replace(/^@/, ''))) {
      toast.error('Ce domaine est déjà autorisé.');
      return;
    }

    const ok = await persist({
      allowedEmailDomains: [...settings.allowedEmailDomains, candidate]
    });
    if (ok) setDomainDraft('');
  }

  async function handleRemoveDomain(domain: string) {
    if (!settings) return;
    await persist({
      allowedEmailDomains: settings.allowedEmailDomains.filter((d) => d !== domain)
    });
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!settings) return null;

  if (!settings.isAppAdmin) {
    return (
      <div className="rounded-2xl border border-border bg-bg-base/40 p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-text-tertiary" />
        <h2 className="font-display text-xl font-bold">Accès réservé</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">
          Seuls les super-administrateurs de cette instance Papyrus peuvent modifier qui a le
          droit de créer un compte.
        </p>
      </div>
    );
  }

  const openToEveryone = settings.allowPublicSignup && settings.allowedEmailDomains.length === 0;

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent-cta" />
          <h2 className="font-display text-2xl font-bold">Accès &amp; inscriptions</h2>
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          Contrôlez qui peut rejoindre cet espace Papyrus, y compris via Google.
        </p>
      </header>

      {openToEveryone && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/5 p-4"
        >
          <Globe className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-semibold text-text-primary">
              Cet espace est actuellement ouvert à tous.
            </p>
            <p className="mt-1 text-text-secondary">
              Sans domaine autorisé, n&apos;importe quel compte Google peut créer un compte
              Papyrus. Ajoutez au moins <code className="font-mono text-xs">mooove.live</code>{' '}
              pour restreindre l&apos;accès à votre organisation.
            </p>
          </div>
        </div>
      )}

      {/* Inscriptions ouvertes ou sur invitation seulement */}
      <section className="rounded-2xl border border-border bg-bg-surface p-6">
        <Switch
          checked={settings.allowPublicSignup}
          onChange={(allowPublicSignup) => persist({ allowPublicSignup })}
          label="Autoriser les inscriptions"
          description="Désactivé, seules les personnes déjà invitées dans un espace de travail peuvent se connecter."
        />
      </section>

      {/* Domaines autorisés */}
      <section className="space-y-4 rounded-2xl border border-border bg-bg-surface p-6">
        <div>
          <h3 className="font-display text-lg font-bold">Domaines email autorisés</h3>
          <p className="mt-1 text-sm text-text-secondary">
            Seules les adresses appartenant à ces domaines peuvent créer un compte. Les
            sous-domaines sont inclus : <code className="font-mono text-xs">mooove.live</code>{' '}
            autorise aussi <code className="font-mono text-xs">rh.mooove.live</code>.
          </p>
          <p className="mt-1 text-xs text-text-tertiary">
            Liste vide = aucune restriction. Les membres existants et les personnes déjà
            invitées gardent leur accès même si vous retirez leur domaine.
          </p>
        </div>

        <form onSubmit={handleAddDomain} className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={domainDraft}
            onChange={(e) => setDomainDraft(e.target.value)}
            placeholder="mooove.live"
            aria-label="Domaine à autoriser"
            className="h-11 flex-1 rounded-xl border border-border-strong bg-bg-base px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-cta focus:outline-hidden"
          />
          <Button type="submit" variant="cta" loading={saving} disabled={!domainDraft.trim()}>
            <Plus className="mr-1 h-4 w-4" />
            Autoriser
          </Button>
        </form>

        {settings.allowedEmailDomains.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-tertiary">
            Aucun domaine autorisé — l&apos;inscription est ouverte à toutes les adresses.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {settings.allowedEmailDomains.map((domain) => (
              <li key={domain} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <span className="text-text-tertiary">@</span>
                  {domain}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveDomain(domain)}
                  disabled={saving}
                  aria-label={`Retirer ${domain}`}
                  className="rounded-md p-1.5 text-text-tertiary transition hover:bg-danger/5 hover:text-danger disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
