'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Handshake,
  LogOut,
  MousePointerClick,
  Plus,
  Wallet
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/pricing';
import {
  buildLedger,
  commissionOn,
  confirmedByLabel,
  landingPath,
  stageOf
} from '@/lib/partners';
import { cn } from '@/lib/utils';
import type {
  Partner,
  PartnerOpenProject,
  PartnerPortalLink,
  PartnerRegistration
} from '@/types';

/**
 * Le portail d'un partenaire.
 *
 * Un partenaire vient ici pour trois raisons, et l'écran les prend dans cet
 * ordre : combien on lui doit, où est son lien, quelles inscriptions il a
 * amenées. Le reste — rejoindre un nouveau projet — est en bas, parce que c'est
 * un geste ponctuel là où les trois premiers sont hebdomadaires.
 *
 * Ce qui n'y figure pas est aussi une décision : les réponses au formulaire.
 * Un partenaire voit qui s'est inscrit et pour quel montant, jamais ce que la
 * personne a répondu. mooove-invoice, lui, ouvre le détail complet ; un
 * bulletin d'inscription peut contenir un numéro de passeport, et ce n'est pas
 * l'affaire de l'apporteur d'affaires.
 */

interface Props {
  partner: Partner;
  links: PartnerPortalLink[];
  registrations: PartnerRegistration[];
  openProjects: PartnerOpenProject[];
  /** Origine publique, pour bâtir des liens copiables et non des chemins. */
  origin: string;
}

export function PartnerPortal({ partner, links, registrations, openProjects, origin }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [openLink, setOpenLink] = useState<string | null>(links[0]?.id ?? null);

  const overall = useMemo(() => buildLedger(registrations), [registrations]);

  const byLink = useMemo(() => {
    const groups = new Map<string, PartnerRegistration[]>();
    for (const row of registrations) {
      const bucket = groups.get(row.project_partner_id);
      if (bucket) bucket.push(row);
      else groups.set(row.project_partner_id, [row]);
    }
    return groups;
  }, [registrations]);

  const money = (amount: number) =>
    formatMoney(amount, overall.currency || 'MUR', overall.currencyPosition);

  async function settle(linkId: string | null) {
    setBusy(linkId ?? 'all');
    try {
      const response = await fetch(`/api/portal/${partner.portal_token}/commission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(linkId ? { project_partner_id: linkId } : {})
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'La confirmation a échoué.');

      if (body.settled === 0) {
        toast.info('Aucune commission à confirmer pour l’instant.');
        return;
      }

      toast.success(
        `${body.settled} commission${body.settled > 1 ? 's' : ''} confirmée${
          body.settled > 1 ? 's' : ''
        }.`
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'La confirmation a échoué.');
    } finally {
      setBusy(null);
    }
  }

  async function join(projectId: string) {
    setBusy(projectId);
    try {
      const response = await fetch(`/api/portal/${partner.portal_token}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId })
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'Le projet n’a pas pu être rejoint.');

      toast.success('Votre lien de partage est prêt.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Le projet n’a pas pu être rejoint.');
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Lien copié.');
    } catch {
      toast.error('La copie a échoué. Sélectionnez le lien et copiez-le à la main.');
    }
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push('/p');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <header className="border-b border-border bg-bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            {partner.logo_url ? (
              // Balise `img` et non `next/image` : le logo est servi par R2,
              // dont le domaine n'est pas déclaré à l'optimiseur.
              <img
                src={partner.logo_url}
                alt=""
                className="h-9 w-9 shrink-0 rounded-lg object-contain"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-mooove-navy text-mooove-ice">
                <Handshake className="h-4 w-4" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold text-text-primary">
                {partner.name}
              </p>
              <p className="text-xs text-text-tertiary">Espace partenaire</p>
            </div>
          </div>

          <Button variant="ghost" size="sm" iconLeft={<LogOut className="h-3.5 w-3.5" />} onClick={() => void signOut()}>
            Se déconnecter
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-6 py-10">
        <section aria-labelledby="commissions">
          <h1 id="commissions" className="font-display text-2xl font-bold text-text-primary">
            Vos commissions
          </h1>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <LedgerCard
              icon={Wallet}
              label="À vous verser"
              value={money(overall.toPay)}
              hint={
                overall.outstandingCount > 0
                  ? `${overall.outstandingCount} inscription${overall.outstandingCount > 1 ? 's' : ''}`
                  : 'Rien en attente'
              }
              emphasis
            />
            <LedgerCard
              icon={Clock}
              label="En attente du paiement client"
              value={money(overall.awaitingClient)}
              hint="Dû dès que le client a réglé"
            />
            <LedgerCard
              icon={BadgeCheck}
              label="Déjà versé"
              value={money(overall.received)}
              hint={`Total acquis : ${money(overall.earned)}`}
            />
          </div>

          {overall.toPay > 0 && (
            <div className="mt-4">
              <Button
                variant="cta"
                size="sm"
                loading={busy === 'all'}
                iconLeft={<Check className="h-3.5 w-3.5" />}
                onClick={() => void settle(null)}
              >
                Tout marquer comme reçu
              </Button>
            </div>
          )}
        </section>

        <section aria-labelledby="projets" className="space-y-4">
          <h2 id="projets" className="font-display text-lg font-bold text-text-primary">
            Vos projets
          </h2>

          {links.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-strong bg-bg-surface p-10 text-center text-sm text-text-secondary">
              Vous ne participez à aucun projet pour l’instant.
            </p>
          ) : (
            links.map((link) => (
              <LinkCard
                key={link.id}
                link={link}
                rows={byLink.get(link.id) ?? []}
                origin={origin}
                expanded={openLink === link.id}
                busy={busy === link.id}
                onToggle={() => setOpenLink(openLink === link.id ? null : link.id)}
                onCopy={copy}
                onSettle={() => void settle(link.id)}
              />
            ))
          )}
        </section>

        {openProjects.length > 0 && (
          <section aria-labelledby="rejoindre" className="space-y-4">
            <h2 id="rejoindre" className="font-display text-lg font-bold text-text-primary">
              Projets que vous pouvez rejoindre
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {openProjects.map((project) => (
                <div
                  key={project.project_id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-border bg-bg-surface p-5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text-primary">{project.project_name}</p>
                    {Number(project.partner_config.commission_percent) > 0 && (
                      <p className="mt-0.5 text-xs text-text-tertiary">
                        {project.partner_config.commission_percent} % de commission
                      </p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === project.project_id}
                    iconLeft={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => void join(project.project_id)}
                  >
                    Rejoindre
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function LedgerCard({
  icon: Icon,
  label,
  value,
  hint,
  emphasis
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-5',
        // Une seule carte porte l'accent : c'est le chiffre qu'on vient
        // chercher. Les trois traitées à l'identique se liraient comme trois
        // totaux également importants, et il faudrait les comparer pour
        // retrouver celui qui compte.
        emphasis ? 'border-accent/40 bg-accent/5' : 'border-border bg-bg-surface'
      )}
    >
      <div className="flex items-center gap-2 text-text-secondary">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums text-text-primary">{value}</p>
      <p className="mt-1 text-xs text-text-tertiary">{hint}</p>
    </div>
  );
}

function LinkCard({
  link,
  rows,
  origin,
  expanded,
  busy,
  onToggle,
  onCopy,
  onSettle
}: {
  link: PartnerPortalLink;
  rows: PartnerRegistration[];
  origin: string;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onCopy: (value: string) => Promise<void>;
  onSettle: () => void;
}) {
  const ledger = buildLedger(rows);
  const shareUrl = `${origin}${landingPath(link.code)}`;
  const paid = rows.filter((row) => row.status === 'paid').length;

  const money = (amount: number) =>
    formatMoney(amount, ledger.currency || link.project_pricing?.currency || 'MUR', ledger.currencyPosition);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="font-display text-base font-bold text-text-primary">{link.project_name}</p>
          <p className="mt-0.5 text-xs text-text-tertiary">
            {link.form_title ?? 'Inscriptions non encore ouvertes'}
            {Number(link.partner_config.commission_percent) > 0 &&
              ` · ${link.partner_config.commission_percent} % de commission`}
          </p>
        </div>

        <div className="text-right">
          <p className="font-display text-lg font-bold tabular-nums text-text-primary">
            {money(ledger.toPay)}
          </p>
          <p className="text-xs text-text-tertiary">à vous verser</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-bg-elevated px-5 py-3">
        <code className="min-w-0 flex-1 truncate rounded-md bg-bg-surface px-3 py-1.5 font-mono text-xs text-text-secondary">
          {shareUrl}
        </code>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Copy className="h-3.5 w-3.5" />}
          onClick={() => void onCopy(shareUrl)}
        >
          Copier
        </Button>
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-xs text-text-secondary transition-colors hover:bg-bg-surface"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Ouvrir
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-5 py-3 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <MousePointerClick className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {link.click_count} visite{link.click_count > 1 ? 's' : ''}
        </span>
        <span>
          {rows.length} inscription{rows.length > 1 ? 's' : ''}
        </span>
        <span>{paid} payée{paid > 1 ? 's' : ''}</span>

        <div className="ml-auto flex items-center gap-2">
          {ledger.toPay > 0 && (
            <Button variant="cta" size="sm" loading={busy} onClick={onSettle}>
              Marquer comme reçu
            </Button>
          )}
          {rows.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onToggle}>
              {expanded ? 'Masquer le détail' : 'Voir le détail'}
            </Button>
          )}
        </div>
      </div>

      {expanded && rows.length > 0 && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-bg-elevated text-xs font-semibold uppercase text-text-secondary">
              <tr>
                <th className="px-5 py-2.5">Date</th>
                <th className="px-5 py-2.5">Inscrit</th>
                <th className="px-5 py-2.5">Référence</th>
                <th className="px-5 py-2.5 text-right">Montant</th>
                <th className="px-5 py-2.5 text-right">Commission</th>
                <th className="px-5 py-2.5">État</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <RegistrationRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RegistrationRow({ row }: { row: PartnerRegistration }) {
  const amount = commissionOn(row.pricing, row.status, row.commission_percent);
  const stage = stageOf(row);

  const money = (value: number) =>
    formatMoney(value, row.pricing?.currency ?? 'MUR', row.pricing?.currency_position ?? 'before');

  return (
    <tr className={cn(row.status === 'void' && 'opacity-55')}>
      <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-text-secondary">
        {new Date(row.completed_at).toLocaleDateString('fr-FR')}
      </td>
      <td className="px-5 py-2.5 text-text-primary">
        <span className="block max-w-[16rem] truncate">{row.respondent_email || '—'}</span>
      </td>
      <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-text-secondary">
        {row.invoice_number || '—'}
      </td>
      <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums text-text-secondary">
        {row.pricing ? money(row.pricing.total) : '—'}
      </td>
      <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums font-medium text-text-primary">
        {amount > 0 ? money(amount) : '—'}
      </td>
      <td className="whitespace-nowrap px-5 py-2.5">
        {row.status === 'void' ? (
          <span className="text-xs text-text-tertiary">Annulée</span>
        ) : (
          <StageBadge stage={stage} by={row.commission_paid_by} />
        )}
      </td>
    </tr>
  );
}

function StageBadge({
  stage,
  by
}: {
  stage: ReturnType<typeof stageOf>;
  by: PartnerRegistration['commission_paid_by'];
}) {
  const styles: Record<typeof stage, string> = {
    awaiting_client: 'border-border-strong text-text-tertiary',
    to_pay: 'border-accent/50 bg-accent/10 text-accent',
    received: 'border-success/40 bg-success/10 text-success'
  };

  const labels: Record<typeof stage, string> = {
    awaiting_client: 'Client non réglé',
    to_pay: 'À vous verser',
    received: 'Versée'
  };

  return (
    <span
      className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', styles[stage])}
      title={stage === 'received' ? confirmedByLabel(by) : undefined}
    >
      {labels[stage]}
    </span>
  );
}
