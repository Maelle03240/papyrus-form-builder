import type { EmbedSettings } from '@/types';

/**
 * Intégration d'un formulaire dans un site tiers.
 *
 * Les options ne sont pas lues en base au moment de l'affichage : elles voyagent
 * dans l'URL de l'iframe, comme chez Tally. C'est ce qui permet d'intégrer le
 * même formulaire à deux endroits avec deux réglages différents — transparent
 * dans une page sombre, cadré à gauche dans une colonne étroite — sans dupliquer
 * le formulaire. La copie enregistrée dans `settings.embed` ne sert qu'à
 * réafficher le dernier réglage dans l'interface.
 */

export interface EmbedOptions {
  enabled: boolean;
  hideTitle: boolean;
  alignLeft: boolean;
  transparentBackground: boolean;
  dynamicHeight: boolean;
  trackEvents: boolean;
}

export const DEFAULT_EMBED_SETTINGS: EmbedSettings = {
  mode: 'standard',
  height: 500,
  dynamic_height: true,
  hide_title: false,
  align_left: false,
  transparent_background: false,
  track_events: false,
  popup_trigger: 'click',
  popup_delay: 3,
  popup_scroll_percent: 50,
  popup_button_label: 'Ouvrir le formulaire',
  popup_once: false
};

/** Un paramètre est actif s'il vaut `1` ou `true` — tolérant, comme une URL doit l'être. */
function flag(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === '1' || raw === 'true';
}

/** Lit les options d'intégration depuis les paramètres d'URL de la page embarquée. */
export function parseEmbedOptions(
  searchParams: Record<string, string | string[] | undefined>
): EmbedOptions {
  return {
    enabled: true,
    hideTitle: flag(searchParams.hideTitle),
    alignLeft: flag(searchParams.alignLeft),
    transparentBackground: flag(searchParams.transparentBackground),
    dynamicHeight: flag(searchParams.dynamicHeight),
    trackEvents: flag(searchParams.trackEvents)
  };
}

/** Construit l'URL de la page embarquée à partir des réglages de l'interface. */
export function buildEmbedUrl(
  baseUrl: string,
  slug: string,
  settings: EmbedSettings
): string {
  const params = new URLSearchParams();
  if (settings.hide_title) params.set('hideTitle', '1');
  if (settings.align_left) params.set('alignLeft', '1');
  if (settings.transparent_background) params.set('transparentBackground', '1');
  if (settings.dynamic_height) params.set('dynamicHeight', '1');
  if (settings.track_events) params.set('trackEvents', '1');

  const query = params.toString();
  return `${baseUrl}/embed/${slug}${query ? `?${query}` : ''}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Extrait à coller dans la page hôte.
 *
 * L'attribut est `data-papyrus-src` et non `src` : c'est `embed.js` qui pose la
 * vraie source, une fois qu'il a installé l'écoute de redimensionnement. Sans
 * cela, une iframe chargée avant le script annoncerait sa hauteur dans le vide.
 */
export function buildEmbedSnippet(params: {
  baseUrl: string;
  slug: string;
  title: string;
  settings: EmbedSettings;
}): string {
  const { baseUrl, slug, title, settings } = params;
  const url = escapeAttribute(buildEmbedUrl(baseUrl, slug, settings));
  const safeTitle = escapeAttribute(title);
  const scriptTag = `<script src="${baseUrl}/embed.js" async></script>`;

  if (settings.mode === 'popup') {
    const attributes = [
      `data-papyrus-popup="${url}"`,
      `data-papyrus-trigger="${settings.popup_trigger ?? 'click'}"`,
      settings.popup_trigger === 'time' ? `data-papyrus-delay="${settings.popup_delay ?? 3}"` : '',
      settings.popup_trigger === 'scroll'
        ? `data-papyrus-scroll="${settings.popup_scroll_percent ?? 50}"`
        : '',
      settings.popup_once ? 'data-papyrus-once="1"' : ''
    ]
      .filter(Boolean)
      .join(' ');

    return [
      `<button type="button" ${attributes}>${escapeAttribute(
        settings.popup_button_label || 'Ouvrir le formulaire'
      )}</button>`,
      scriptTag
    ].join('\n');
  }

  if (settings.mode === 'fullpage') {
    return [
      `<iframe data-papyrus-src="${url}" data-papyrus-fullpage="1" width="100%" height="100%" frameborder="0" marginheight="0" marginwidth="0" title="${safeTitle}" style="border:none;width:100%;height:100vh;"></iframe>`,
      scriptTag
    ].join('\n');
  }

  const height = settings.dynamic_height ? 500 : Math.max(120, settings.height || 500);

  return [
    `<iframe data-papyrus-src="${url}" loading="lazy" width="100%" height="${height}" frameborder="0" marginheight="0" marginwidth="0" title="${safeTitle}" style="border:none;width:100%;"></iframe>`,
    scriptTag
  ].join('\n');
}
