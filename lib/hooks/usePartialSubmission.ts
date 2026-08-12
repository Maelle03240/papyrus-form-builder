'use client';

import { useEffect, useMemo, useRef } from 'react';

/**
 * Enregistrement des réponses partielles.
 *
 * Une session est un identifiant aléatoire rangé dans le `localStorage` du
 * répondant. Il ne l'identifie pas : il ne sert qu'à retrouver sa propre ébauche
 * pour la remplacer plutôt que d'en accumuler une par frappe au clavier.
 *
 * L'envoi est temporisé (deux secondes sans modification) et le dernier état est
 * poussé au `pagehide` avec `sendBeacon` — la requête part alors même si l'onglet
 * se ferme, ce qu'un `fetch` classique ne garantit pas.
 */

const SESSION_PREFIX = 'papyrus-session-';
const DEBOUNCE_MS = 2000;

function readOrCreateSessionId(formId: string): string {
  const key = `${SESSION_PREFIX}${formId}`;

  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;

    const created =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

    window.localStorage.setItem(key, created);
    return created;
  } catch {
    // Navigation privée ou stockage bloqué : la session ne survit pas au
    // rechargement, mais l'ébauche de la visite en cours reste enregistrée.
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export interface PartialSubmission {
  /** Identifiant à joindre à l'envoi définitif pour convertir l'ébauche. */
  sessionId: string | null;
  /** À appeler après un envoi réussi : la session ne doit pas être réutilisée. */
  clear: () => void;
}

export function usePartialSubmission(params: {
  enabled: boolean;
  formId: string;
  slug: string;
  language: string;
  responses: Record<string, unknown>;
  /** Requis sur un formulaire protégé par mot de passe. */
  accessToken?: string;
}): PartialSubmission {
  const { enabled, formId, slug, language, responses, accessToken } = params;

  const sessionId = useMemo(() => {
    if (!enabled || typeof window === 'undefined') return null;
    return readOrCreateSessionId(formId);
  }, [enabled, formId]);

  const latest = useRef(responses);
  latest.current = responses;

  const submitted = useRef(false);
  const serialized = JSON.stringify(responses);

  useEffect(() => {
    if (!enabled || !sessionId || submitted.current) return;
    if (Object.keys(latest.current).length === 0) return;

    const timer = window.setTimeout(() => {
      fetch(`/api/submit/${slug}/partial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ responses: latest.current, language, sessionId, accessToken })
      }).catch(() => {
        // Une ébauche perdue n'est pas une erreur à montrer au répondant.
      });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [enabled, sessionId, slug, language, accessToken, serialized]);

  // Dernier état au moment où l'onglet disparaît.
  useEffect(() => {
    if (!enabled || !sessionId) return;

    const flush = () => {
      if (submitted.current) return;
      if (Object.keys(latest.current).length === 0) return;

      const payload = JSON.stringify({
        responses: latest.current,
        language,
        sessionId,
        accessToken
      });

      try {
        navigator.sendBeacon(
          `/api/submit/${slug}/partial`,
          new Blob([payload], { type: 'application/json' })
        );
      } catch {
        // sendBeacon indisponible : la temporisation aura déjà fait le travail
        // dans la grande majorité des cas.
      }
    };

    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [enabled, sessionId, slug, language, accessToken]);

  return {
    sessionId,
    clear: () => {
      submitted.current = true;
      try {
        window.localStorage.removeItem(`${SESSION_PREFIX}${formId}`);
      } catch {
        // Rien à nettoyer si le stockage est inaccessible.
      }
    }
  };
}
