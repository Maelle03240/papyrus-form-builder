'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Copy,
  Handshake,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  Search,
  Trash2
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import {
  createPartner,
  deletePartner,
  listPartners,
  updatePartner
} from '@/lib/store';
import { portalPath } from '@/lib/partners';
import type { Partner } from '@/types';

/**
 * L'annuaire des partenaires d'un espace de travail.
 *
 * Un partenaire est créé UNE fois ici, puis rattaché aux projets qu'il promeut.
 * C'est la différence avec mooove-invoice, où un partenaire est recréé
 * événement par événement : là-bas, la même personne finit avec quatre
 * identifiants et quatre portails, et personne ne sait plus lequel lui envoyer.
 *
 * L'accès au portail s'ouvre d'ici, et le lien est AFFICHÉ plutôt qu'envoyé :
 * aucun serveur d'e-mail n'est configuré sur cette instance, et un écran qui
 * annoncerait « invitation envoyée » pour un message qui n'existe pas serait
 * pire que pas d'invitation du tout.
 */

interface Props {
  teamId: string;
}

const BLANK = { name: '', email: '', phone: '', website: '', logo_url: '', notes: '' };

export function PartnerDirectory({ teamId }: Props) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<Partner | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const [removing, setRemoving] = useState<Partner | null>(null);
  const [invite, setInvite] = useState<{ partner: Partner; link: string } | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPartners(await listPartners(teamId));
    } catch (error) {
      console.error('Failed to load partners:', error);
      toast.error("L'annuaire n'a pas pu être chargé.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const term = search.trim().toLowerCase();
  const visible = term
    ? partners.filter((partner) =>
        `${partner.name} ${partner.email} ${partner.website}`.toLowerCase().includes(term)
      )
    : partners;

  function openCreate() {
    setDraft(BLANK);
    setEditing(null);
    setCreating(true);
  }

  function openEdit(partner: Partner) {
    setDraft({
      name: partner.name,
      email: partner.email,
      phone: partner.phone,
      website: partner.website,
      logo_url: partner.logo_url,
      notes: partner.notes
    });
    setEditing(partner);
    setCreating(true);
  }

  async function save() {
    if (!draft.name.trim()) {
      toast.error('Donnez un nom à ce partenaire.');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updatePartner(editing.id, draft);
      } else {
        await createPartner({
          teamId,
          name: draft.name,
          email: draft.email,
          phone: draft.phone,
          website: draft.website,
          logoUrl: draft.logo_url,
          notes: draft.notes
        });
      }

      setCreating(false);
      await load();
    } catch (error) {
      // Le cas courant : deux fiches pour la même adresse. Le dire précisément
      // évite de laisser croire à une panne.
      const message =
        error && typeof error === 'object' && 'code' in error && error.code === '23505'
          ? 'Un partenaire porte déjà cette adresse e-mail dans cet espace.'
          : "Le partenaire n'a pas pu être enregistré.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(partner: Partner) {
    try {
      await deletePartner(partner.id);
      toast.success('Partenaire supprimé.');
      await load();
    } catch (error) {
      console.error('Failed to delete partner:', error);
      toast.error("Le partenaire n'a pas pu être supprimé.");
    } finally {
      setRemoving(null);
    }
  }

  async function openPortal(partner: Partner) {
    setInviting(partner.id);
    try {
      const response = await fetch(`/api/partners/${partner.id}/invite`, { method: 'POST' });
      const body = await response.json().catch(() => null);

      if (!response.ok) throw new Error(body?.error ?? "L'accès n'a pas pu être ouvert.");

      setInvite({ partner, link: body.invite_link });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "L'accès n'a pas pu être ouvert.");
    } finally {
      setInviting(null);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copié.`);
    } catch {
      toast.error('La copie a échoué. Sélectionnez le texte et copiez-le à la main.');
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Partenaires</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Les entreprises et les personnes qui promeuvent vos projets auprès de
            leurs propres clients.
          </p>
        </div>
        <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
          Nouveau partenaire
        </Button>
      </div>

      {partners.length > 0 && (
        <div className="relative mt-6">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher un partenaire"
            aria-label="Rechercher un partenaire"
            className="h-10 w-full max-w-md rounded-lg border border-border bg-bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-tertiary"
          />
        </div>
      )}

      {loading ? (
        <div className="mt-6 space-y-3" aria-busy="true">
          <div className="h-20 animate-pulse rounded-xl bg-bg-elevated" />
          <div className="h-20 animate-pulse rounded-xl bg-bg-elevated" />
        </div>
      ) : partners.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border-strong bg-bg-surface p-14 text-center">
          <Handshake className="mx-auto h-10 w-10 text-text-tertiary" />
          <h2 className="mt-4 font-display text-lg font-bold text-text-primary">
            Aucun partenaire
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
            Créez une fiche par partenaire. Elle vaudra pour tous vos projets :
            un partenaire garde le même espace, quel que soit le nombre
            d’événements qu’il promeut.
          </p>
          <Button className="mt-5" variant="primary" onClick={openCreate}>
            Créer le premier
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border-strong bg-bg-surface p-10 text-center text-sm text-text-secondary">
          Aucun partenaire ne correspond à cette recherche.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {visible.map((partner) => (
            <li
              key={partner.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-bg-surface p-5"
            >
              <div className="flex min-w-0 items-center gap-3">
                {partner.logo_url ? (
                  // Balise `img` et non `next/image` : le logo est servi par
                  // R2, dont le domaine n'est pas déclaré à l'optimiseur.
                  <img
                    src={partner.logo_url}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg object-contain"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-text-tertiary">
                    <Building2 className="h-4 w-4" aria-hidden />
                  </span>
                )}

                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">{partner.name}</p>
                  <p className="mt-0.5 truncate text-xs text-text-tertiary">
                    {partner.email || 'Sans adresse e-mail'}
                    {typeof partner.project_count === 'number' &&
                      ` · ${partner.project_count} projet${partner.project_count > 1 ? 's' : ''}`}
                    {partner.user_id ? ' · accès ouvert' : ' · accès non ouvert'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={inviting === partner.id}
                  iconLeft={<KeyRound className="h-3.5 w-3.5" />}
                  onClick={() => void openPortal(partner)}
                >
                  {partner.user_id ? 'Renvoyer l’accès' : 'Ouvrir l’accès'}
                </Button>
                <button
                  type="button"
                  onClick={() => openEdit(partner)}
                  className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-bg-elevated hover:text-text-primary"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  <span className="sr-only">Modifier {partner.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRemoving(partner)}
                  className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-bg-elevated hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  <span className="sr-only">Supprimer {partner.name}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={creating}
        onClose={() => setCreating(false)}
        title={editing ? 'Modifier le partenaire' : 'Nouveau partenaire'}
      >
        <div className="space-y-4">
          <Input
            id="partner-name"
            label="Nom ou raison sociale"
            required
            maxLength={120}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <Input
            id="partner-email"
            label="Adresse e-mail"
            type="email"
            hint="Nécessaire pour lui ouvrir son espace partenaire."
            maxLength={180}
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          />
          <Input
            id="partner-phone"
            label="Téléphone"
            maxLength={60}
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          />
          <Input
            id="partner-website"
            label="Site web"
            maxLength={200}
            value={draft.website}
            onChange={(event) => setDraft({ ...draft, website: event.target.value })}
          />
          <Input
            id="partner-logo"
            label="Logo (URL)"
            hint="Affiché sur ses pages d’accueil."
            maxLength={500}
            value={draft.logo_url}
            onChange={(event) => setDraft({ ...draft, logo_url: event.target.value })}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {editing ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(invite)}
        onClose={() => setInvite(null)}
        title="Accès au portail"
        size="lg"
      >
        {invite && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Transmettez ce lien à {invite.partner.name}. Il l’emmène choisir un
              mot de passe, puis directement sur son espace. Il n’est valable
              qu’une fois — vous pourrez en émettre un autre à tout moment.
            </p>

            <LinkBox
              label="Lien d’activation"
              value={invite.link}
              onCopy={() => void copy(invite.link, 'Lien d’activation')}
            />

            <LinkBox
              label="Adresse permanente de son espace"
              value={`${typeof window === 'undefined' ? '' : window.location.origin}${portalPath(
                invite.partner.portal_token
              )}`}
              onCopy={() =>
                void copy(
                  `${window.location.origin}${portalPath(invite.partner.portal_token)}`,
                  'Lien du portail'
                )
              }
            />

            {invite.partner.email && (
              <p className="flex items-start gap-2 rounded-lg bg-bg-elevated p-3 text-xs text-text-secondary">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Aucun e-mail n’est envoyé automatiquement : envoyez ce lien à{' '}
                {invite.partner.email} depuis votre messagerie.
              </p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(removing)}
        title="Supprimer ce partenaire ?"
        message={
          removing
            ? `${removing.name} sera retiré de tous les projets et ses liens de partage cesseront de fonctionner. Les inscriptions qu’il a amenées restent, sans lui être attribuées.`
            : ''
        }
        confirmLabel="Supprimer"
        variant="danger"
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

function LinkBox({
  label,
  value,
  onCopy
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-text-secondary">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated p-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">
          {value}
        </code>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Copy className="h-3.5 w-3.5" />}
          onClick={onCopy}
        >
          Copier
        </Button>
      </div>
    </div>
  );
}
