'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import QRCode from 'qrcode';
import { Check, Code2, Copy, Download, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { updateForm } from '@/lib/store';
import { getBaseUrl } from '@/lib/utils';
import { DEFAULT_EMBED_SETTINGS, buildEmbedSnippet } from '@/lib/embed';
import { EmbedModeCard } from './EmbedModeCard';
import { EmbedPanel } from './EmbedPanel';
import type { EmbedMode, EmbedSettings, Form } from '@/types';

/**
 * Onglet « Partage » : lien direct, QR code et intégration.
 *
 * L'extrait affiché sous les cartes est celui du mode sélectionné, avec les
 * dernières options enregistrées : dans le cas courant — coller un formulaire
 * standard sur une page — il n'y a rien de plus à faire qu'un copier-coller. Le
 * panneau complet ne s'ouvre que si l'on veut régler quelque chose.
 */
export function FormShareTab({ form }: { form: Form }) {
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [panelMode, setPanelMode] = useState<EmbedMode | null>(null);

  const [embedSettings, setEmbedSettings] = useState<EmbedSettings>(() => ({
    ...DEFAULT_EMBED_SETTINGS,
    ...(form.settings?.embed ?? {})
  }));

  const baseUrl = getBaseUrl();
  const publicUrl = `${baseUrl}/f/${form.slug}`;

  /**
   * Le QR code, dessiné ici.
   *
   * Il venait d'`api.qrserver.com`, et **il ne s'affichait jamais** : la
   * politique de sécurité de contenu n'autorise `img-src` que pour nos propres
   * domaines, donc le navigateur bloquait l'image sans un mot à l'écran. Ouvrir
   * la politique aurait été le geste facile ; il aurait aussi envoyé l'adresse
   * de chaque formulaire à un service tiers à chaque ouverture de l'onglet, et
   * fait dépendre une fonctionnalité de la disponibilité de ce service.
   *
   * Il est donc calculé dans le navigateur, en `data:` — ce que la politique
   * autorise déjà. Aucune requête ne sort.
   */
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    let cancelled = false;

    void QRCode.toDataURL(publicUrl, { width: 400, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch((error: unknown) => {
        // Un QR absent n'empêche pas de partager : le lien est juste au-dessus.
        console.error('Génération du QR code échouée:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [publicUrl]);

  const snippet = buildEmbedSnippet({
    baseUrl,
    slug: form.slug,
    title: form.title,
    settings: embedSettings
  });

  async function copy(text: string, kind: 'link' | 'embed') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
      toast.success(kind === 'link' ? 'Lien copié !' : 'Code copié !');
    } catch {
      toast.error('Impossible de copier — sélectionnez le texte manuellement.');
    }
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      await updateForm(form.id, {
        status: 'published',
        published_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to publish form:', error);
      toast.error('Erreur lors de la publication.');
    } finally {
      setPublishing(false);
    }
  }

  /** Mémorise le dernier réglage d'intégration, sans bloquer l'interface dessus. */
  async function persistEmbedSettings(settings: EmbedSettings) {
    setEmbedSettings(settings);
    try {
      await updateForm(form.id, {
        settings: { ...(form.settings ?? {}), embed: settings }
      });
    } catch (error) {
      console.error('Failed to persist embed settings:', error);
    }
  }

  if (form.status === 'draft') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 rounded-lg border border-warning/40 bg-warning/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-medium text-warning">
            i. Publiez le formulaire pour partager le lien
          </div>
          <Button onClick={handlePublish} disabled={publishing}>
            {publishing ? 'Publication...' : 'Publier maintenant'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {form.status === 'closed' && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning">
          i. Ce formulaire est archivé. Les visiteurs voient le message de clôture défini dans
          l&apos;onglet Paramètres, et ne peuvent plus répondre.
        </div>
      )}

      {/* Lien direct */}
      <section className="rounded-lg border border-border bg-bg-surface p-5">
        <div className="mb-3 flex items-center gap-2">
          <Link2 className="h-4 w-4 text-text-secondary" />
          <h3 className="font-display text-lg">Lien direct</h3>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={publicUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="h-10 flex-1 rounded-md border border-border-strong bg-bg-base px-3 font-mono text-sm text-text-primary focus:border-accent focus:outline-hidden"
          />
          <Button
            variant="secondary"
            iconLeft={
              copied === 'link' ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />
            }
            onClick={() => copy(publicUrl, 'link')}
          >
            {copied === 'link' ? 'Copié !' : 'Copier le lien'}
          </Button>
        </div>
        <p className="papyrus-meta mt-2 text-xs">
          i. Partagez ce lien — toute personne le recevant pourra remplir le formulaire (sauf si
          l&apos;accès est restreint).
        </p>
      </section>

      {/* Intégration */}
      <section className="space-y-4">
        <div>
          <h3 className="font-display text-lg">Intégrer le formulaire</h3>
          <p className="papyrus-meta mt-1 max-w-2xl text-sm">
            i. Trois façons de poser ce formulaire sur votre propre site. Choisissez-en une pour
            régler la hauteur, le fond et le titre, puis copiez le code obtenu.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(['standard', 'popup', 'fullpage'] as EmbedMode[]).map((mode) => (
            <EmbedModeCard
              key={mode}
              mode={mode}
              selected={embedSettings.mode === mode}
              onSelect={() => {
                setEmbedSettings((previous) => ({ ...previous, mode }));
                setPanelMode(mode);
              }}
            />
          ))}
        </div>

        <div className="rounded-lg border border-border bg-bg-surface p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-text-secondary" />
              <h4 className="font-display text-base">Code à coller</h4>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPanelMode(embedSettings.mode)}
            >
              Régler les options
            </Button>
          </div>

          <textarea
            readOnly
            value={snippet}
            onFocus={(e) => e.currentTarget.select()}
            rows={embedSettings.mode === 'popup' ? 5 : 4}
            className="w-full resize-none rounded-md border border-border-strong bg-bg-base px-3 py-2 font-mono text-xs leading-relaxed text-text-primary focus:border-accent focus:outline-hidden"
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="papyrus-meta text-xs">
              i. À coller dans le HTML de votre page, à l&apos;endroit voulu.
            </p>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={
                copied === 'embed' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />
              }
              onClick={() => copy(snippet, 'embed')}
            >
              {copied === 'embed' ? 'Copié' : 'Copier'}
            </Button>
          </div>
        </div>
      </section>

      {/* QR Code */}
      <section className="rounded-lg border border-border bg-bg-surface p-5">
        <h3 className="mb-3 font-display text-lg">QR Code</h3>
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-md border border-border bg-white p-3">
            {qrUrl ? (
              // Balise `img` et non `next/image` : la source est une `data:` URL
              // calculée dans le navigateur, que l'optimiseur ne sait pas traiter.
              <img src={qrUrl} alt="QR code du formulaire" width={200} height={200} />
            ) : (
              <div className="h-[200px] w-[200px] animate-pulse rounded bg-bg-elevated" />
            )}
          </div>
          {qrUrl && (
            <a
              href={qrUrl}
              download={`papyrus-${form.slug}-qr.png`}
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
            >
              <Download className="h-3.5 w-3.5" /> Télécharger le QR
            </a>
          )}
        </div>
        <p className="papyrus-meta mt-3 text-center text-xs">
          i. À imprimer ou afficher pour un événement / vitrine.
        </p>
      </section>

      <AnimatePresence>
        {panelMode && (
          <EmbedPanel
            form={form}
            initialMode={panelMode}
            onClose={() => setPanelMode(null)}
            onPersist={persistEmbedSettings}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
