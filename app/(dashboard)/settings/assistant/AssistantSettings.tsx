'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, AudioLines, KeyRound, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/Toast';

/**
 * Les réglages de l'assistant, par espace de travail.
 *
 * **Par espace et non par instance** : une clé unique côté serveur ferait payer
 * une équipe pour les appels d'une autre, sans qu'aucune des deux puisse le
 * voir. Chacune apporte la sienne, en règle le plafond, et lit sa propre
 * dépense.
 *
 * La clé n'est jamais relue — ni ici, ni ailleurs. L'écran affiche son
 * empreinte, « sk-…a3f9 », et rien de plus : la table qui la porte n'a aucune
 * policy, donc aucun navigateur ne peut l'atteindre, fût-elle chiffrée.
 */

interface Props {
  teamId: string;
}

interface SettingsView {
  configured: boolean;
  enabled: boolean;
  key_hint: string;
  model: string;
  monthly_budget_usd: number | null;
  price_input_per_mtok: number;
  price_output_per_mtok: number;
  spent_this_month: number;
  encryption_ready: boolean;
}

const MODELS = [
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra — le plus capable' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol — plus rapide' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna — le plus économique' }
];

export function AssistantSettings({ teamId }: Props) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [budget, setBudget] = useState('');
  const [priceIn, setPriceIn] = useState('');
  const [priceOut, setPriceOut] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/ai/settings?team=${encodeURIComponent(teamId)}`);
      if (!response.ok) throw new Error('lecture impossible');

      const data = (await response.json()) as SettingsView;
      setView(data);
      setBudget(data.monthly_budget_usd === null ? '' : String(data.monthly_budget_usd));
      setPriceIn(data.price_input_per_mtok ? String(data.price_input_per_mtok) : '');
      setPriceOut(data.price_output_per_mtok ? String(data.price_output_per_mtok) : '');
    } catch (error) {
      console.error('Lecture des réglages IA échouée:', error);
      toast.error("Les réglages n'ont pas pu être chargés.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      const response = await fetch(`/api/ai/settings?team=${encodeURIComponent(teamId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });

      const data = await response.json().catch(() => null);

      if (response.status === 403) {
        setForbidden(true);
        return;
      }
      if (!response.ok) throw new Error(data?.error ?? 'Enregistrement impossible.');

      setView(data as SettingsView);
      setApiKey('');
      toast.success('Réglages enregistrés.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="h-72 animate-pulse rounded-xl bg-bg-elevated" aria-busy="true" />;
  }

  if (!view) return null;

  const budgetValue = budget.trim() === '' ? null : Number(budget);
  const tracking = view.price_input_per_mtok > 0 || view.price_output_per_mtok > 0;

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          <h1 className="font-display text-xl font-bold text-text-primary">Assistant</h1>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          L’assistant construit vos formulaires en appelant des outils, sous vos
          propres droits : il ne peut rien toucher que vous ne pourriez toucher
          vous-même. Il utilise la clé d’API de cet espace de travail.
        </p>
      </header>

      {forbidden && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Seul un administrateur de l’espace peut modifier ces réglages. Les
          vôtres n’ont pas été enregistrés.
        </p>
      )}

      {!view.encryption_ready && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Le chiffrement des secrets n’est pas configuré sur cette instance
          (<code className="font-mono text-xs">APP_ENCRYPTION_KEY</code>). Tant
          qu’il manque, aucune clé ne peut être enregistrée.
        </p>
      )}

      <section className="space-y-4 rounded-xl border border-border p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-text-primary">Clé d’API</h2>
            <p className="mt-1 text-sm text-text-secondary">
              {view.configured ? (
                <>
                  Une clé est enregistrée :{' '}
                  <code className="font-mono text-xs text-text-primary">{view.key_hint}</code>. Elle
                  ne peut plus être relue — pour la remplacer, saisissez la nouvelle.
                </>
              ) : (
                'Aucune clé enregistrée. L’assistant reste inactif tant qu’il n’en a pas.'
              )}
            </p>
          </div>
          <Switch
            checked={view.enabled}
            onChange={(enabled) => void save({ enabled })}
            label="Activer"
          />
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              id="ai-key"
              label="Nouvelle clé"
              type="password"
              placeholder="sk-…"
              autoComplete="off"
              maxLength={300}
              disabled={!view.encryption_ready}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          <Button
            variant="primary"
            loading={saving}
            disabled={!apiKey.trim() || !view.encryption_ready}
            iconLeft={<KeyRound className="h-4 w-4" />}
            onClick={() => void save({ api_key: apiKey, enabled: true })}
          >
            Enregistrer
          </Button>
          {view.configured && (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => void save({ api_key: '' })}
            >
              Retirer
            </Button>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border p-6">
        <div>
          <h2 className="font-display text-base font-bold text-text-primary">Modèle</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Celui qui répond à vos demandes. Un modèle absent de votre compte
            fera échouer chaque message avec un motif explicite.
          </p>
        </div>

        <label className="block max-w-sm">
          <span className="sr-only">Modèle</span>
          <select
            value={view.model}
            onChange={(event) => void save({ model: event.target.value })}
            className="h-10 w-full rounded-lg border border-border bg-bg-surface px-3 text-sm text-text-primary"
          >
            {MODELS.every((model) => model.id !== view.model) && (
              <option value={view.model}>{view.model}</option>
            )}
            {MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="space-y-4 rounded-xl border border-border p-6">
        <div className="flex items-center gap-2">
          <AudioLines className="h-4 w-4 text-accent" aria-hidden />
          <h2 className="font-display text-base font-bold text-text-primary">Voix</h2>
        </div>

        {/* Rien à régler ici, et c'est le renseignement utile : les deux
            modèles vocaux sont fixes, ils ne suivent pas le choix ci-dessus, et
            l'un des deux ne se compte pas comme le reste. Le dire coûte un
            paragraphe ; le taire coûte une facture inexpliquée. */}
        <p className="max-w-2xl text-sm text-text-secondary">
          L’assistant s’écoute et se parle. La <strong>dictée</strong> transcrit
          un enregistrement en texte que vous relisez avant d’envoyer ; la{' '}
          <strong>conversation vocale</strong> répond pendant que vous parlez et
          construit en même temps. Les deux utilisent la clé de cet espace, avec
          des modèles dédiés — le choix ci-dessus ne s’y applique pas.
        </p>

        <p className="max-w-2xl text-sm text-text-secondary">
          Une différence à connaître : en conversation vocale, le son va
          directement de votre navigateur au fournisseur, sans passer par nos
          serveurs. C’est ce qui rend la réponse immédiate — et c’est pourquoi la
          consommation d’une session vocale est <strong>déclarée par le
          navigateur à la fin</strong>, quand celle des messages écrits est
          mesurée à la source. Le plafond, lui, reste vérifié avant chaque
          ouverture de session.
        </p>

        <p className="text-xs text-text-tertiary">
          Le micro exige une connexion sécurisée : en développement local, seule
          l’adresse <code className="font-mono">localhost</code> y donne droit.
        </p>
      </section>

      <section className="space-y-5 rounded-xl border border-border p-6">
        <div>
          <h2 className="font-display text-base font-bold text-text-primary">Budget</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Le plafond est vérifié <strong>avant</strong> chaque message, et se
            remet à zéro le 1<sup>er</sup> du mois. En dollars — la monnaie de
            facturation du fournisseur, pas celle de vos formulaires.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            id="ai-budget"
            label="Plafond mensuel ($)"
            type="number"
            min={0}
            step="1"
            hint="Vide = aucun plafond."
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            onBlur={() =>
              void save({
                monthly_budget_usd:
                  budgetValue === null || Number.isNaN(budgetValue) ? null : budgetValue
              })
            }
          />
          <Input
            id="ai-price-in"
            label="Prix entrée ($ / M jetons)"
            type="number"
            min={0}
            step="0.01"
            value={priceIn}
            onChange={(event) => setPriceIn(event.target.value)}
            onBlur={() => void save({ price_input_per_mtok: Number(priceIn) || 0 })}
          />
          <Input
            id="ai-price-out"
            label="Prix sortie ($ / M jetons)"
            type="number"
            min={0}
            step="0.01"
            value={priceOut}
            onChange={(event) => setPriceOut(event.target.value)}
            onBlur={() => void save({ price_output_per_mtok: Number(priceOut) || 0 })}
          />
        </div>

        {/* Les tarifs ne sont pas codés en dur, et l'écran le dit plutôt que de
            laisser croire à une surveillance qui n'existe pas : un prix figé
            dans le dépôt afficherait des montants faux avec l'aplomb d'un
            chiffre exact, le jour où le fournisseur change sa grille. */}
        <p className="text-xs text-text-tertiary">
          {tracking ? (
            <>
              Dépensé ce mois-ci :{' '}
              <strong className="tabular-nums text-text-secondary">
                {view.spent_this_month.toFixed(2)} $
              </strong>
              {view.monthly_budget_usd ? ` sur ${view.monthly_budget_usd.toFixed(2)} $.` : '.'}
            </>
          ) : (
            <>
              Sans tarifs renseignés, la dépense reste à zéro et le plafond ne
              peut rien déclencher. Les tarifs de votre modèle figurent sur la
              page de facturation de votre fournisseur.
            </>
          )}
        </p>
      </section>
    </div>
  );
}
