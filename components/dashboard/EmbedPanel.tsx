'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Code2, Copy, ExternalLink, Link2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/Toast';
import { cn, getBaseUrl } from '@/lib/utils';
import { DEFAULT_EMBED_SETTINGS, buildEmbedSnippet, buildEmbedUrl } from '@/lib/embed';
import type { EmbedMode, EmbedSettings, Form, PopupTrigger } from '@/types';

/**
 * Panneau d'intégration.
 *
 * Colonne de gauche : le mode, les options, le code. Colonne de droite : le
 * formulaire réellement chargé dans une iframe, avec les options appliquées —
 * pas une maquette. Ce que l'on voit ici est exactement ce que verra un visiteur
 * du site hôte, ce qui évite l'aller-retour « je colle, je regarde, je reviens
 * changer une case ».
 */

interface Props {
  form: Form;
  initialMode: EmbedMode;
  onClose: () => void;
  /** Mémorise le dernier réglage sur le formulaire. Peut échouer sans conséquence. */
  onPersist?: (settings: EmbedSettings) => void;
}

const TRIGGER_LABELS: Record<PopupTrigger, string> = {
  click: 'Au clic sur un bouton',
  time: 'Après un délai',
  scroll: 'Au défilement de la page',
  exit: 'À la sortie de la page'
};

export function EmbedPanel({ form, initialMode, onClose, onPersist }: Props) {
  const [settings, setSettings] = useState<EmbedSettings>(() => ({
    ...DEFAULT_EMBED_SETTINGS,
    ...(form.settings?.embed ?? {}),
    mode: initialMode
  }));

  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const baseUrl = getBaseUrl();
  const embedUrl = useMemo(
    () => buildEmbedUrl(baseUrl, form.slug, settings),
    [baseUrl, form.slug, settings]
  );
  const snippet = useMemo(
    () => buildEmbedSnippet({ baseUrl, slug: form.slug, title: form.title, settings }),
    [baseUrl, form.slug, form.title, settings]
  );

  // Le réglage est enregistré à la fermeture, pas à chaque frappe : basculer
  // quatre interrupteurs ne doit pas déclencher quatre écritures en base. D'où
  // la référence : mettre `settings` en dépendance ferait tourner le nettoyage —
  // donc l'écriture — à chaque changement, exactement ce qu'on veut éviter.
  const latestSettings = useRef(settings);
  latestSettings.current = settings;

  const persist = useRef(onPersist);
  persist.current = onPersist;

  useEffect(() => {
    return () => persist.current?.(latestSettings.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  function update<K extends keyof EmbedSettings>(key: K, value: EmbedSettings[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }

  async function copy(text: string, kind: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
      toast.success(kind === 'code' ? 'Code copié !' : 'Lien copié !');
    } catch {
      toast.error('Impossible de copier — sélectionnez le texte manuellement.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        role="dialog"
        aria-modal="true"
        aria-label="Intégrer le formulaire"
        className="relative z-10 m-auto flex h-[92vh] w-[min(1200px,96vw)] overflow-hidden rounded-2xl border border-border bg-bg-base shadow-2xl"
      >
        {/* ---- Colonne des réglages ---- */}
        <aside className="flex w-[340px] shrink-0 flex-col border-r border-border bg-bg-surface">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="font-display text-xl font-bold text-text-primary">Intégrer</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-text-tertiary transition hover:bg-bg-elevated hover:text-text-primary"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-6">
            <label className="block">
              <span className="sr-only">Mode d’intégration</span>
              <select
                value={settings.mode}
                onChange={(event) => update('mode', event.target.value as EmbedMode)}
                className="h-10 w-full rounded-xl border border-border-strong bg-bg-base px-3 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
              >
                <option value="standard">Standard</option>
                <option value="popup">Popup</option>
                <option value="fullpage">Pleine page</option>
              </select>
            </label>

            <div className="space-y-2">
              <Button
                className="w-full"
                iconLeft={<Code2 className="h-4 w-4" />}
                onClick={() => setShowCode((open) => !open)}
              >
                {showCode ? 'Masquer le code' : 'Obtenir le code'}
              </Button>
              <button
                type="button"
                onClick={() => copy(embedUrl, 'link')}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs text-text-secondary transition hover:text-text-primary"
              >
                {copied === 'link' ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                Copier le lien d’intégration
              </button>
            </div>

            {showCode && (
              <div className="space-y-2 rounded-xl border border-border bg-bg-base p-3">
                <textarea
                  readOnly
                  value={snippet}
                  rows={settings.mode === 'popup' ? 5 : 4}
                  onFocus={(event) => event.currentTarget.select()}
                  className="w-full resize-none rounded-lg border border-border-strong bg-bg-surface p-2 font-mono text-[11px] leading-relaxed text-text-primary focus:border-accent-cta focus:outline-hidden"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  iconLeft={
                    copied === 'code' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />
                  }
                  onClick={() => copy(snippet, 'code')}
                >
                  {copied === 'code' ? 'Copié' : 'Copier le code'}
                </Button>
                <p className="text-[11px] leading-snug text-text-tertiary">
                  i. Collez ce bloc dans le HTML de votre page. Le script
                  <code className="mx-1 font-mono">embed.js</code>
                  n’est chargé qu’une fois, même avec plusieurs formulaires.
                </p>
              </div>
            )}

            <div className="border-t border-border pt-5">
              <h3 className="mb-3 font-display text-base font-bold text-text-primary">Options</h3>

              <div className="space-y-4">
                {settings.mode !== 'fullpage' && (
                  <label className="block">
                    <span className="mb-1 block text-sm text-text-secondary">Hauteur</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={120}
                        max={5000}
                        value={settings.height}
                        disabled={settings.dynamic_height}
                        onChange={(event) =>
                          update('height', Math.max(120, Number(event.target.value) || 120))
                        }
                        className="h-9 flex-1 rounded-md border border-border-strong bg-bg-base px-3 text-sm text-text-primary disabled:opacity-50 focus:border-accent-cta focus:outline-hidden"
                      />
                      <span className="text-xs text-text-tertiary">px</span>
                    </div>
                  </label>
                )}

                {settings.mode !== 'fullpage' && (
                  <OptionRow>
                    <Switch
                      checked={settings.dynamic_height}
                      onChange={(value) => update('dynamic_height', value)}
                      label="Hauteur dynamique"
                      description="L’iframe s’adapte au contenu, sans barre de défilement interne."
                    />
                  </OptionRow>
                )}

                <OptionRow>
                  <Switch
                    checked={settings.hide_title}
                    onChange={(value) => update('hide_title', value)}
                    label="Masquer le titre"
                    description="Utile quand votre page affiche déjà le titre."
                  />
                </OptionRow>

                <OptionRow>
                  <Switch
                    checked={settings.align_left}
                    onChange={(value) => update('align_left', value)}
                    label="Aligner à gauche"
                  />
                </OptionRow>

                <OptionRow>
                  <Switch
                    checked={settings.transparent_background}
                    onChange={(value) => update('transparent_background', value)}
                    label="Fond transparent"
                    description="Le fond de votre page remplace celui du formulaire."
                  />
                </OptionRow>

                <OptionRow>
                  <Switch
                    checked={settings.track_events}
                    onChange={(value) => update('track_events', value)}
                    label="Suivre les évènements"
                    description="Émet papyrus:form-loaded et papyrus:form-submitted vers votre page (et dataLayer)."
                  />
                </OptionRow>

                {settings.mode === 'popup' && (
                  <div className="space-y-4 rounded-xl border border-border bg-bg-base p-3">
                    <label className="block">
                      <span className="mb-1 block text-sm text-text-secondary">Déclencheur</span>
                      <select
                        value={settings.popup_trigger ?? 'click'}
                        onChange={(event) =>
                          update('popup_trigger', event.target.value as PopupTrigger)
                        }
                        className="h-9 w-full rounded-md border border-border-strong bg-bg-surface px-2 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
                      >
                        {(Object.keys(TRIGGER_LABELS) as PopupTrigger[]).map((trigger) => (
                          <option key={trigger} value={trigger}>
                            {TRIGGER_LABELS[trigger]}
                          </option>
                        ))}
                      </select>
                    </label>

                    {settings.popup_trigger === 'click' && (
                      <label className="block">
                        <span className="mb-1 block text-sm text-text-secondary">
                          Libellé du bouton
                        </span>
                        <input
                          value={settings.popup_button_label ?? ''}
                          onChange={(event) => update('popup_button_label', event.target.value)}
                          className="h-9 w-full rounded-md border border-border-strong bg-bg-surface px-3 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
                        />
                      </label>
                    )}

                    {settings.popup_trigger === 'time' && (
                      <label className="block">
                        <span className="mb-1 block text-sm text-text-secondary">
                          Délai (secondes)
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={300}
                          value={settings.popup_delay ?? 3}
                          onChange={(event) =>
                            update('popup_delay', Math.max(0, Number(event.target.value) || 0))
                          }
                          className="h-9 w-full rounded-md border border-border-strong bg-bg-surface px-3 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
                        />
                      </label>
                    )}

                    {settings.popup_trigger === 'scroll' && (
                      <label className="block">
                        <span className="mb-1 block text-sm text-text-secondary">
                          Défilement (%)
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={settings.popup_scroll_percent ?? 50}
                          onChange={(event) =>
                            update(
                              'popup_scroll_percent',
                              Math.min(100, Math.max(1, Number(event.target.value) || 1))
                            )
                          }
                          className="h-9 w-full rounded-md border border-border-strong bg-bg-surface px-3 text-sm text-text-primary focus:border-accent-cta focus:outline-hidden"
                        />
                      </label>
                    )}

                    <Switch
                      checked={settings.popup_once ?? false}
                      onChange={(value) => update('popup_once', value)}
                      label="Une seule fois par visiteur"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* ---- Aperçu ---- */}
        <section className="flex min-w-0 flex-1 flex-col bg-bg-elevated">
          <div className="flex items-center justify-between px-6 py-4">
            <h3 className="font-display text-lg font-bold text-text-secondary">Aperçu</h3>
            <a
              href={embedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
            >
              Ouvrir dans un onglet
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <div className="flex-1 overflow-auto px-6 pb-6">
            <EmbedPreview settings={settings} url={embedUrl} title={form.title} />
          </div>
        </section>
      </motion.div>
    </div>
  );
}

function OptionRow({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-border pb-4 last:border-b-0 last:pb-0">{children}</div>;
}

/**
 * Aperçu réel : une iframe pointant sur la même URL que le code fourni.
 *
 * La hauteur dynamique n'est pas simulée ici — c'est `embed.js` qui l'assure sur
 * le site hôte, et le charger dans l'aperçu ferait dialoguer la page avec
 * elle-même. On affiche donc une hauteur fixe généreuse, avec la mention de ce
 * qui se passera réellement.
 */
function EmbedPreview({
  settings,
  url,
  title
}: {
  settings: EmbedSettings;
  url: string;
  title: string;
}) {
  const [popupOpen, setPopupOpen] = useState(false);

  if (settings.mode === 'popup') {
    return (
      <div className="relative min-h-full rounded-xl border border-border bg-bg-surface p-8">
        <div className="space-y-2">
          <div className="h-3 w-1/3 rounded-sm bg-text-tertiary/25" />
          <div className="h-2 w-full rounded-sm bg-text-tertiary/15" />
          <div className="h-2 w-4/5 rounded-sm bg-text-tertiary/15" />
          <div className="h-2 w-2/3 rounded-sm bg-text-tertiary/15" />
        </div>

        <div className="mt-8">
          <Button variant="cta" onClick={() => setPopupOpen(true)}>
            {settings.popup_button_label || 'Ouvrir le formulaire'}
          </Button>
          <p className="mt-2 text-xs text-text-tertiary">
            i. Déclencheur configuré :{' '}
            {TRIGGER_LABELS[settings.popup_trigger ?? 'click'].toLowerCase()}. L’aperçu s’ouvre au
            clic quel que soit le réglage.
          </p>
        </div>

        <AnimatePresence>
          {popupOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center rounded-xl bg-mooove-navy/55 p-6"
              onClick={() => setPopupOpen(false)}
            >
              <div
                className="relative max-h-full w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setPopupOpen(false)}
                  className="absolute right-3 top-3 z-10 rounded-full bg-black/5 p-1.5 text-mooove-navy"
                  aria-label="Fermer l’aperçu"
                >
                  <X className="h-4 w-4" />
                </button>
                <iframe src={url} title={title} className="h-[520px] w-full border-0" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const height = settings.mode === 'fullpage' ? '100%' : `${Math.max(120, settings.height)}px`;

  return (
    <div
      className={cn(
        'min-h-full overflow-hidden rounded-xl border border-border',
        // Un damier discret rend le fond transparent visible pour ce qu'il est.
        settings.transparent_background ? 'papyrus-checkerboard' : 'bg-bg-surface'
      )}
    >
      <iframe
        src={url}
        title={title}
        className="w-full border-0"
        style={{
          height: settings.dynamic_height && settings.mode !== 'fullpage' ? 600 : height,
          minHeight: settings.mode === 'fullpage' ? '70vh' : undefined
        }}
      />
    </div>
  );
}
