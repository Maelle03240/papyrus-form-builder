'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * La dictée.
 *
 * On enregistre, on envoie, on récupère du texte — et ce texte tombe dans la
 * zone de saisie, où il se relit et se corrige avant d'être envoyé. C'est
 * volontaire : une dictée qui partirait toute seule ferait construire un
 * formulaire sur un mot mal entendu, et il faudrait ensuite défaire.
 *
 * Tout passe par le serveur, contrairement au temps réel : rien à ouvrir dans
 * un pare-feu, aucune clé dans le navigateur, et une consommation mesurée là où
 * elle a lieu.
 */

export type DictationStatus = 'idle' | 'recording' | 'transcribing';

/**
 * Durée maximale d'un enregistrement.
 *
 * Deux minutes valent une longue description de formulaire. Au-delà, c'est un
 * micro resté ouvert : on coupe et on transcrit ce qui a été dit, plutôt que de
 * jeter l'enregistrement.
 */
const MAX_SECONDS = 120;

interface Options {
  teamId: string;
  onText: (text: string) => void;
  onError: (message: string) => void;
}

export function useDictation({ teamId, onText, onError }: Options) {
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [seconds, setSeconds] = useState(0);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const live = useRef({ onText, onError, teamId });
  useEffect(() => {
    live.current = { onText, onError, teamId };
  });

  const cleanup = useCallback(() => {
    if (ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    recorder.current = null;
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (status !== 'idle') return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      live.current.onError(
        'Le micro n’est pas accessible. Autorisez-le dans les réglages du navigateur.'
      );
      return;
    }

    // Le format n'est pas imposé : Safari ne produit pas de WebM, Chrome et
    // Firefox n'en produisent que. Laisser le navigateur choisir, et déclarer
    // au serveur ce qu'il a produit, évite un enregistrement vide sur iPhone.
    let instance: MediaRecorder;
    try {
      instance = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      live.current.onError('Ce navigateur ne sait pas enregistrer de son.');
      return;
    }

    chunks.current = [];
    recorder.current = instance;

    instance.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };

    instance.onstop = async () => {
      cleanup();
      setSeconds(0);

      const type = instance.mimeType || 'audio/webm';
      const blob = new Blob(chunks.current, { type });
      chunks.current = [];

      if (blob.size === 0) {
        setStatus('idle');
        live.current.onError('Rien n’a été enregistré.');
        return;
      }

      setStatus('transcribing');

      try {
        const body = new FormData();
        body.append('team_id', live.current.teamId);
        body.append('audio', new File([blob], `dictee.${extensionFor(type)}`, { type }));

        const response = await fetch('/api/ai/transcribe', { method: 'POST', body });
        const payload = await response.json().catch(() => null);

        if (!response.ok) throw new Error(payload?.error ?? 'La dictée n’a pas pu être transcrite.');

        live.current.onText(String(payload.text ?? ''));
      } catch (error) {
        live.current.onError(
          error instanceof Error ? error.message : 'La dictée n’a pas pu être transcrite.'
        );
      } finally {
        setStatus('idle');
      }
    };

    instance.start();
    setStatus('recording');
    setSeconds(0);

    ticker.current = setInterval(() => {
      setSeconds((previous) => {
        const next = previous + 1;
        if (next >= MAX_SECONDS) stop();
        return next;
      });
    }, 1000);
  }, [cleanup, status, stop]);

  useEffect(() => cleanup, [cleanup]);

  return { status, seconds, start, stop, maxSeconds: MAX_SECONDS };
}

/** L'extension attendue par le fournisseur, déduite du type produit. */
function extensionFor(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/mp4' || base === 'audio/m4a' || base === 'audio/x-m4a') return 'm4a';
  if (base === 'audio/mpeg' || base === 'audio/mpga') return 'mp3';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/wav' || base === 'audio/x-wav') return 'wav';
  return 'webm';
}
