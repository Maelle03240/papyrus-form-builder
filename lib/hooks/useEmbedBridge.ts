'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { EmbedOptions } from '@/lib/embed';

/**
 * Dialogue entre le formulaire embarqué et la page qui l'héberge.
 *
 * Deux canaux, tous deux en `postMessage` :
 *  · la hauteur du document, pour que l'iframe se redimensionne au lieu
 *    d'afficher une barre de défilement interne ;
 *  · les évènements du formulaire (affiché, envoyé), pour que le site hôte
 *    puisse déclencher son propre suivi.
 *
 * La cible est `'*'` : nous ne connaissons pas le domaine de la page hôte, et le
 * message ne contient qu'une hauteur et un nom d'évènement — rien qu'un site
 * tiers ne puisse déjà observer. L'inverse n'est pas vrai : cette page n'écoute
 * aucun message entrant, donc aucune page hôte ne peut la piloter.
 */

export interface EmbedBridge {
  /** Signale un évènement à la page hôte (ignoré si le suivi est désactivé). */
  emit: (event: string, payload?: Record<string, unknown>) => void;
}

export function useEmbedBridge(options: EmbedOptions | null): EmbedBridge {
  const lastHeight = useRef(0);

  const emit = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      if (!options?.enabled || !options.trackEvents) return;
      if (typeof window === 'undefined' || window.parent === window) return;

      window.parent.postMessage({ source: 'papyrus', type: event, ...payload }, '*');
    },
    [options?.enabled, options?.trackEvents]
  );

  useEffect(() => {
    if (!options?.enabled || !options.dynamicHeight) return;
    if (typeof window === 'undefined' || window.parent === window) return;

    const report = () => {
      const height = Math.ceil(
        Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
          document.body.offsetHeight
        )
      );

      // Un écart d'un pixel suffirait à déclencher une boucle infinie avec
      // certains navigateurs : on ne remonte qu'un changement significatif.
      if (Math.abs(height - lastHeight.current) < 4) return;
      lastHeight.current = height;

      window.parent.postMessage({ source: 'papyrus', type: 'resize', height }, '*');
    };

    report();

    const observer = new ResizeObserver(report);
    observer.observe(document.body);

    // Les transitions Framer Motion changent la hauteur sans que le corps ne
    // soit redimensionné à l'instant où l'observateur se déclenche.
    const interval = window.setInterval(report, 500);
    window.addEventListener('load', report);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener('load', report);
    };
  }, [options?.enabled, options?.dynamicHeight]);

  return { emit };
}
