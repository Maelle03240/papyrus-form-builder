'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Copy,
  ExternalLink,
  Handshake,
  Link2,
  MousePointerClick,
  Plus,
  Trash2,
  Wallet
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/pricing';
import {
  attachPartner,
  detachPartner,
  listPartners,
  listProjectPartners,
  setCommissionPaid,
  updateProject
} from '@/lib/store';
import {
  buildLedger,
  joinPath,
  landingPath,
  partnerConfigOf
} from '@/lib/partners';
import type {
  Form,
  Partner,
  PartnerConfig,
  PartnerRegistration,
  Project,
  ProjectPartner,
  SubmissionStatus,
  TotalsSnapshot
} from '@/types';

/**
 * L'onglet Partenaires d'un projet.
 *
 * Trois choses, dans l'ordre où on s'en sert : le programme (l'interrupteur, le
 * taux, le formulaire promu), la page d'accueil que verront les clients des
 * partenaires, et la liste des partenaires avec ce qu'on leur doit.
 *
 * Le montant dû par partenaire est affiché en clair — « MUR 3 000,00 à verser »
 * — plutôt que derrière un clic : c'est le chiffre pour lequel on vient, et
 * payer ses apporteurs d'affaires ne doit jamais être un travail de
 * reconstitution.
 */

interface Props {
  project: Project;
  forms: Form[];
  onChanged: () => void;
}

/** Une réponse attribuée, telle que l'onglet la lit. */
interface AttributedRow {
  id: string;
  project_partner_id: string;
  status: SubmissionStatus;
  pricing: TotalsSnapshot | null;
  commission_paid_at: string | null;
  completed_at: string;
}

export function ProjectPartnersTab({ project, forms, onChanged }: Props) {
  const [links, setLinks] = useState<ProjectPartner[]>([]);
  const [directory, setDirectory] = useState<Partner[]>([]);
  const [rows, setRows] = useState<AttributedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [detaching, setDetaching] = useState<ProjectPartner | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const config = useMemo(() => partnerConfigOf(project.partner_config), [project.partner_config]);
  const percent = Number(config.commission_percent ?? 0);

  const load = useCallback(async () => {
    try {
      const [attached, all] = await Promise.all([
        listProjectPartners(project.id),
        listPartners(project.team_id)
      ]);

      setLinks(attached);
      setDirectory(all);

      const ids = attached.map((link) => link.id);
      if (ids.length === 0) {
        setRows([]);
        return;
      }

      const { data, error } = await createClient()
        .from('submissions')
        .select('id, project_partner_id, status, pricing, commission_paid_at, completed_at')
        .in('project_partner_id', ids)
        .eq('is_partial', false);

      if (error) throw error;
      setRows((data ?? []) as AttributedRow[]);
    } catch (error) {
      console.error('Failed to load project partners:', error);
      toast.error("Les partenaires n'ont pas pu être chargés.");
    } finally {
      setLoading(false);
    }
  }, [project.id, project.team_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const byLink = useMemo(() => {
    const groups = new Map<string, AttributedRow[]>();
    for (const row of rows) {
      const bucket = groups.get(row.project_partner_id);
      if (bucket) bucket.push(row);
      else groups.set(row.project_partner_id, [row]);
    }
    return groups;
  }, [rows]);

  async function patchConfig(patch: Partial<PartnerConfig>) {
    try {
      await updateProject(project.id, { partner_config: { ...config, ...patch } });
      onChanged();
    } catch (error) {
      console.error('Failed to update partner config:', error);
      toast.error("Le réglage n'a pas pu être enregistré.");
    }
  }

  /**
   * Le lien d'auto-inscription est fabriqué à la demande, et jamais retiré.
   *
   * Éteindre l'option suffit à fermer la page ; effacer le jeton casserait
   * définitivement un lien peut-être déjà collé dans une dizaine d'e-mails, et
   * le rallumer plus tard en donnerait un autre.
   */
  async function toggleSelfRegister(enabled: boolean) {
    const token =
      project.partner_join_token ?? (enabled ? crypto.randomUUID().replace(/-/g, '') : null);

    try {
      await updateProject(project.id, {
        partner_config: { ...config, self_register: enabled },
        ...(token && !project.partner_join_token ? { partner_join_token: token } : {})
      });
      onChanged();
    } catch (error) {
      console.error('Failed to toggle self-registration:', error);
      toast.error("Le lien d'auto-inscription n'a pas pu être créé.");
    }
  }

  async function handleAttach(partner: Partner) {
    setBusy(partner.id);
    try {
      await attachPartner(project.id, partner);
      toast.success(`${partner.name} participe désormais à ce projet.`);
      setAdding(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Le partenaire n'a pas pu être ajouté.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDetach(link: ProjectPartner) {
    try {
      await detachPartner(link.id);
      toast.success('Le lien de partage a été retiré.');
      await load();
    } catch (error) {
      console.error('Failed to detach partner:', error);
      toast.error("Le partenaire n'a pas pu être retiré.");
    } finally {
      setDetaching(null);
    }
  }

  async function handleSettle(link: ProjectPartner) {
    const due = (byLink.get(link.id) ?? []).filter(
      (row) => row.status === 'paid' && !row.commission_paid_at
    );

    if (due.length === 0) return;

    setBusy(link.id);
    try {
      await setCommissionPaid(
        due.map((row) => row.id),
        true,
        'staff'
      );
      toast.success(
        `${due.length} commission${due.length > 1 ? 's' : ''} marquée${due.length > 1 ? 's' : ''} versée${
          due.length > 1 ? 's' : ''
        }.`
      );
      await load();
    } catch (error) {
      console.error('Failed to settle commissions:', error);
      toast.error("Le versement n'a pas pu être enregistré.");
    } finally {
      setBusy(null);
    }
  }

  const available = directory.filter(
    (partner) => !links.some((link) => link.partner_id === partner.id)
  );

  const publishedForms = forms.filter((form) => form.status === 'published');

  if (loading) {
    return (
      <div className="space-y-4 px-6 py-10" aria-busy="true">
        <div className="h-32 animate-pulse rounded-xl bg-bg-elevated" />
        <div className="h-56 animate-pulse rounded-xl bg-bg-elevated" />
      </div>
    );
  }

  return (
    <div className="space-y-8 px-6 py-8">
      <section className="rounded-xl border border-border bg-bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-6">
          <div>
            <h2 className="font-display text-lg font-bold text-text-primary">
              Programme partenaire
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              Chaque partenaire reçoit son propre lien vers une page à ses
              couleurs. Les inscriptions qui en viennent lui sont attribuées, et
              les commissions se règlent depuis cette page.
            </p>
          </div>
          <Switch
            checked={config.enabled === true}
            onChange={(enabled) => void patchConfig({ enabled })}
            label="Activer"
          />
        </div>

        {config.enabled && (
          <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-text-primary">Commission</span>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="partner-commission"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={String(percent)}
                  onChange={(event) =>
                    void patchConfig({ commission_percent: Number(event.target.value) || 0 })
                  }
                />
                <span className="text-sm text-text-secondary">%</span>
              </div>
              <span className="mt-1.5 block text-xs text-text-tertiary">
                Du total de chaque inscription encaissée. 0 = aucune commission.
              </span>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-text-primary">Formulaire promu</span>
              <select
                value={config.form_id ?? ''}
                onChange={(event) => void patchConfig({ form_id: event.target.value || null })}
                className="mt-1.5 h-10 w-full rounded-lg border border-border bg-bg-surface px-3 text-sm text-text-primary"
              >
                <option value="">
                  {publishedForms[0]
                    ? `Automatique — ${publishedForms[0].title}`
                    : 'Aucun formulaire publié'}
                </option>
                {publishedForms.map((form) => (
                  <option key={form.id} value={form.id}>
                    {form.title}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-xs text-text-tertiary">
                La page d’accueil des partenaires y conduit. Sans choix, c’est le
                premier formulaire publié du projet.
              </span>
            </label>

            <LandingFields config={config} onPatch={patchConfig} />

            <div className="md:col-span-2">
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-bg-elevated p-4">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    Laisser les partenaires s’inscrire eux-mêmes
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    Un lien public à envoyer à vos prospects. Ils renseignent
                    leurs coordonnées ; vous leur ouvrez ensuite leur espace
                    depuis l’annuaire.
                  </p>
                  {config.self_register && project.partner_join_token && (
                    <CopyRow value={joinPath(project.partner_join_token)} />
                  )}
                </div>
                <Switch
                  checked={config.self_register === true}
                  onChange={(enabled) => void toggleSelfRegister(enabled)}
                  label="Activer"
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {config.enabled && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-text-primary">
              Partenaires de ce projet
            </h2>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setAdding(true)}
            >
              Ajouter un partenaire
            </Button>
          </div>

          {links.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-strong bg-bg-surface p-12 text-center">
              <Handshake className="mx-auto h-10 w-10 text-text-tertiary" />
              <h3 className="mt-4 font-display text-lg font-bold text-text-primary">
                Aucun partenaire sur ce projet
              </h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
                Ajoutez-en un depuis l’annuaire, ou activez le lien
                d’auto-inscription pour qu’ils viennent d’eux-mêmes.
              </p>
              <Link
                href="/partners"
                className="mt-4 inline-flex text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                Ouvrir l’annuaire
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {links.map((link) => (
                <PartnerRow
                  key={link.id}
                  link={link}
                  rows={byLink.get(link.id) ?? []}
                  percent={percent}
                  busy={busy === link.id}
                  onSettle={() => void handleSettle(link)}
                  onDetach={() => setDetaching(link)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <Modal isOpen={adding} onClose={() => setAdding(false)} title="Ajouter un partenaire">
        {available.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-sm text-text-secondary">
              {directory.length === 0
                ? 'Votre annuaire est vide.'
                : 'Tous vos partenaires participent déjà à ce projet.'}
            </p>
            <Link
              href="/partners"
              className="mt-3 inline-flex text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              Ouvrir l’annuaire
            </Link>
          </div>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {available.map((partner) => (
              <li key={partner.id}>
                <button
                  type="button"
                  disabled={busy === partner.id}
                  onClick={() => void handleAttach(partner)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-bg-elevated disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text-primary">
                      {partner.name}
                    </span>
                    {partner.email && (
                      <span className="block truncate text-xs text-text-tertiary">
                        {partner.email}
                      </span>
                    )}
                  </span>
                  <Plus className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(detaching)}
        title="Retirer ce partenaire du projet ?"
        message={
          detaching
            ? `Le lien ${landingPath(detaching.code)} cessera de fonctionner. Les inscriptions déjà amenées restent, mais ne lui seront plus attribuées.`
            : ''
        }
        confirmLabel="Retirer"
        variant="danger"
        onConfirm={() => {
          if (detaching) void handleDetach(detaching);
        }}
        onClose={() => setDetaching(null)}
      />
    </div>
  );
}

// ============================================================================
// Page d'accueil
// ============================================================================

function LandingFields({
  config,
  onPatch
}: {
  config: PartnerConfig;
  onPatch: (patch: Partial<PartnerConfig>) => Promise<void>;
}) {
  return (
    <>
      <label className="block md:col-span-2">
        <span className="text-sm font-medium text-text-primary">Titre de la page d’accueil</span>
        <Input
          id="partner-heading"
          className="mt-1.5"
          placeholder="Sans titre, le nom du projet est utilisé"
          maxLength={140}
          value={config.heading?.fr ?? ''}
          onChange={(event) => void onPatch({ heading: { fr: event.target.value } })}
        />
      </label>

      <label className="block md:col-span-2">
        <span className="text-sm font-medium text-text-primary">Présentation</span>
        <textarea
          id="partner-message"
          rows={4}
          maxLength={2000}
          value={config.message?.fr ?? ''}
          onChange={(event) => void onPatch({ message: { fr: event.target.value } })}
          placeholder="Ce que verront les clients de vos partenaires avant de s’inscrire."
          className="mt-1.5 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-text-primary">Libellé du bouton</span>
        <Input
          id="partner-cta"
          className="mt-1.5"
          placeholder="S’inscrire"
          maxLength={60}
          value={config.cta_label?.fr ?? ''}
          onChange={(event) => void onPatch({ cta_label: { fr: event.target.value } })}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-text-primary">Visuel (URL)</span>
        <Input
          id="partner-image"
          className="mt-1.5"
          placeholder="https://media.mooove.ltd/…"
          maxLength={500}
          value={config.image_url ?? ''}
          onChange={(event) => void onPatch({ image_url: event.target.value })}
        />
      </label>
    </>
  );
}

// ============================================================================
// Une ligne de partenaire
// ============================================================================

function PartnerRow({
  link,
  rows,
  percent,
  busy,
  onSettle,
  onDetach
}: {
  link: ProjectPartner;
  rows: AttributedRow[];
  percent: number;
  busy: boolean;
  onSettle: () => void;
  onDetach: () => void;
}) {
  // Le registre est bâti par le MÊME module que le portail du partenaire : les
  // deux côtés doivent afficher le même chiffre, et deux calculs séparés
  // divergent le jour où l'un des deux est corrigé.
  const ledger = buildLedger(
    rows.map(
      (row): PartnerRegistration => ({
        id: row.id,
        project_partner_id: row.project_partner_id,
        partner_id: link.partner_id,
        project_id: link.project_id,
        completed_at: row.completed_at,
        respondent_email: null,
        respondent_language: 'fr',
        status: row.status,
        invoice_number: null,
        pricing: row.pricing,
        commission_paid_at: row.commission_paid_at,
        commission_paid_by: '',
        commission_percent: percent
      })
    )
  );

  const paid = rows.filter((row) => row.status === 'paid').length;
  const money = (amount: number) =>
    formatMoney(amount, ledger.currency || 'MUR', ledger.currencyPosition);

  return (
    <div className="rounded-xl border border-border bg-bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="font-medium text-text-primary">{link.partner?.name ?? 'Partenaire'}</p>
          <p className="mt-0.5 text-xs text-text-tertiary">
            {link.partner?.email || 'Sans adresse e-mail'}
            {link.status === 'disabled' && ' · lien désactivé'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-display text-base font-bold tabular-nums text-text-primary">
              {money(ledger.toPay)}
            </p>
            <p className="text-xs text-text-tertiary">à verser</p>
          </div>
          {ledger.toPay > 0 && (
            <Button
              variant="cta"
              size="sm"
              loading={busy}
              iconLeft={<Wallet className="h-3.5 w-3.5" />}
              onClick={onSettle}
            >
              Marquer payé
            </Button>
          )}
          <button
            type="button"
            onClick={onDetach}
            title="Retirer du projet"
            className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-bg-elevated hover:text-danger"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            <span className="sr-only">Retirer {link.partner?.name} du projet</span>
          </button>
        </div>
      </div>

      <CopyRow value={landingPath(link.code)} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-5 py-3 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <MousePointerClick className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {link.click_count} visite{link.click_count > 1 ? 's' : ''}
        </span>
        <span>
          {rows.length} inscription{rows.length > 1 ? 's' : ''}
        </span>
        <span>
          {paid} payée{paid > 1 ? 's' : ''}
        </span>
        <span>En attente du client : {money(ledger.awaitingClient)}</span>
        <span>Déjà versé : {money(ledger.received)}</span>
      </div>
    </div>
  );
}

/**
 * Un chemin, présenté comme un lien complet.
 *
 * L'origine est lue dans le navigateur : c'est exactement l'adresse depuis
 * laquelle la personne travaille, donc celle qui fonctionnera chez son
 * destinataire.
 */
function CopyRow({ value }: { value: string }) {
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const full = `${origin}${value}`;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border bg-bg-elevated px-5 py-3">
      <Link2 className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">{full}</code>
      <Button
        variant="ghost"
        size="sm"
        iconLeft={<Copy className="h-3.5 w-3.5" />}
        onClick={() => {
          void navigator.clipboard
            .writeText(full)
            .then(() => toast.success('Lien copié.'))
            .catch(() => toast.error('La copie a échoué.'));
        }}
      >
        Copier
      </Button>
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-text-secondary transition-colors hover:bg-bg-surface"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        Ouvrir
      </a>
    </div>
  );
}
