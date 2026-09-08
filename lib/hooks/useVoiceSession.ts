'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * La conversation vocale, côté navigateur.
 *
 * Le flux audio va directement d'ici au fournisseur, en WebRTC : le serveur
 * n'est sur le chemin que deux fois — pour émettre le jeton éphémère au début,
 * et pour exécuter chaque outil que le modèle demande. C'est la seule
 * architecture qui tienne : faire transiter l'audio par notre serveur
 * ajouterait un aller-retour à chaque phrase, et une conversation qui répond
 * avec une seconde de retard n'est plus une conversation.
 *
 * **Les outils, eux, ne s'exécutent jamais ici.** Le modèle demande, le
 * navigateur relaie à `/api/ai/tool`, et c'est le serveur qui écrit — sous la
 * session de la personne, donc sous RLS. Laisser le navigateur écrire
 * directement en base reviendrait à donner à un modèle distant la main sur les
 * droits de celui qui l'écoute.
 */

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'stopping';

export interface VoiceToolTrace {
  name: string;
  ok: boolean;
  message: string;
}

export interface VoiceHandlers {
  /** Ce que la personne vient de dire, une fois transcrit. */
  onUserText: (text: string) => void;
  /** Ce que l'assistant répond, au fil de la parole. */
  onAssistantDelta: (delta: string) => void;
  /** Fin d'une réponse parlée : la bulle suivante repart de zéro. */
  onAssistantDone: () => void;
  onTool: (trace: VoiceToolTrace) => void;
  /** Premier instantané de la session — permet de tout annuler. */
  onSnapshot: (versionId: string) => void;
  onAnchor: (ids: { projectId: string | null; formId: string | null }) => void;
  onError: (message: string) => void;
}

interface Options {
  teamId: string;
  projectId: string | null;
  formId: string | null;
  handlers: VoiceHandlers;
}

interface MintResponse {
  token: string;
  sdp_url: string;
  model: string;
  max_seconds: number;
}

export function useVoiceSession({ teamId, projectId, formId, handlers }: Options) {
  const [status, setStatus] = useState<VoiceStatus>('idle');

  const pc = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** L'ancrage évolue pendant la session : l'assistant peut créer le formulaire. */
  const anchor = useRef({ projectId, formId });
  /** Vrai tant qu'aucune écriture n'a eu lieu — pilote l'instantané. */
  const needsSnapshot = useRef(true);
  const usage = useRef({ input: 0, output: 0 });

  /**
   * Les gestionnaires dans une référence.
   *
   * Le panneau les recrée à chaque rendu ; les capturer dans les rappels de la
   * connexion figerait l'état du premier rendu, et la conversation écrirait
   * dans une bulle qui n'existe plus.
   */
  const live = useRef(handlers);
  useEffect(() => {
    live.current = handlers;
  });

  /**
   * Envoie un message au modèle par le canal de données.
   *
   * Déclarée avant ses appelants : une fonction hissée fonctionnerait, mais le
   * compilateur React refuse de raisonner sur une valeur lue avant d'exister.
   */
  const send = useCallback((message: Record<string, unknown>) => {
    if (channel.current?.readyState === 'open') {
      channel.current.send(JSON.stringify(message));
    }
  }, []);

  const stop = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    channel.current?.close();
    channel.current = null;

    pc.current?.close();
    pc.current = null;

    mic.current?.getTracks().forEach((track) => track.stop());
    mic.current = null;

    if (audio.current) {
      audio.current.srcObject = null;
      audio.current.remove();
      audio.current = null;
    }

    const spent = usage.current;
    usage.current = { input: 0, output: 0 };

    setStatus('idle');

    // La déclaration de consommation part APRÈS la fermeture : elle ne doit ni
    // retarder l'arrêt du micro, ni empêcher la fermeture si elle échoue.
    if (spent.input > 0 || spent.output > 0) {
      try {
        await fetch('/api/ai/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            team_id: teamId,
            input_tokens: spent.input,
            output_tokens: spent.output
          })
        });
      } catch (error) {
        console.error('Déclaration de consommation vocale échouée:', error);
      }
    }
  }, [teamId]);

  /** Exécute un outil demandé par le modèle et lui rend le résultat. */
  const runTool = useCallback(
    async (callId: string, name: string, rawArguments: string) => {
      let parsedArguments: unknown = {};
      try {
        parsedArguments = rawArguments ? JSON.parse(rawArguments) : {};
      } catch {
        // Des arguments illisibles ne justifient pas de couper la conversation :
        // le modèle reçoit le refus et recommence.
        parsedArguments = {};
      }

      let payload: {
        ok: boolean;
        message: string;
        version_id: string | null;
        project_id: string | null;
        form_id: string | null;
      };

      try {
        const response = await fetch('/api/ai/tool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            team_id: teamId,
            name,
            arguments: parsedArguments,
            project_id: anchor.current.projectId,
            form_id: anchor.current.formId,
            snapshot: needsSnapshot.current
          })
        });

        const body = await response.json().catch(() => null);

        if (!response.ok) {
          payload = {
            ok: false,
            message: body?.error ?? 'Action refusée.',
            version_id: null,
            project_id: anchor.current.projectId,
            form_id: anchor.current.formId
          };
        } else {
          payload = body;
        }
      } catch (error) {
        console.error('Outil vocal en échec:', error);
        payload = {
          ok: false,
          message: 'Le serveur n’a pas répondu.',
          version_id: null,
          project_id: anchor.current.projectId,
          form_id: anchor.current.formId
        };
      }

      if (payload.version_id) {
        needsSnapshot.current = false;
        live.current.onSnapshot(payload.version_id);
      }

      if (
        payload.project_id !== anchor.current.projectId ||
        payload.form_id !== anchor.current.formId
      ) {
        anchor.current = { projectId: payload.project_id, formId: payload.form_id };
        live.current.onAnchor(anchor.current);
      }

      live.current.onTool({ name, ok: payload.ok, message: payload.message });

      // Le résultat repart au modèle, puis on lui demande de reprendre la
      // parole : sans ce second message, il attendrait indéfiniment.
      send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ ok: payload.ok, message: payload.message })
        }
      });
      send({ type: 'response.create' });
    },
    [send, teamId]
  );

  const handleEvent = useCallback(
    (event: Record<string, unknown>) => {
      const type = String(event.type ?? '');

      // Le nom de l'événement de transcription a changé d'une version de l'API
      // à l'autre (`response.audio_transcript.delta`, puis
      // `response.output_audio_transcript.delta`). On reconnaît le suffixe
      // plutôt que la chaîne entière : la conversation survit à la prochaine
      // renomination.
      if (type.endsWith('audio_transcript.delta') && type.startsWith('response.')) {
        live.current.onAssistantDelta(String(event.delta ?? ''));
        return;
      }

      if (type === 'conversation.item.input_audio_transcription.completed') {
        const text = String(event.transcript ?? '').trim();
        if (text) live.current.onUserText(text);
        return;
      }

      if (type === 'response.function_call_arguments.done') {
        void runTool(
          String(event.call_id ?? ''),
          String(event.name ?? ''),
          String(event.arguments ?? '')
        );
        return;
      }

      if (type === 'response.done' || type === 'response.completed') {
        const response = (event.response ?? {}) as {
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        usage.current.input += response.usage?.input_tokens ?? 0;
        usage.current.output += response.usage?.output_tokens ?? 0;
        live.current.onAssistantDone();
        return;
      }

      if (type === 'error') {
        const detail = (event.error ?? {}) as { message?: string };
        console.error('Erreur de session vocale:', detail);
        live.current.onError('La session vocale a rencontré une erreur.');
      }
    },
    [runTool]
  );

  const start = useCallback(async () => {
    if (status !== 'idle') return;
    setStatus('connecting');

    anchor.current = { projectId, formId };
    needsSnapshot.current = true;
    usage.current = { input: 0, output: 0 };

    let minted: MintResponse;
    try {
      const response = await fetch('/api/ai/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, project_id: projectId, form_id: formId })
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'La session vocale n’a pas pu s’ouvrir.');
      minted = body as MintResponse;
    } catch (error) {
      setStatus('idle');
      live.current.onError(
        error instanceof Error ? error.message : 'La session vocale n’a pas pu s’ouvrir.'
      );
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Un refus de micro n'est pas une panne : c'est un choix, et le message
      // doit dire où le changer plutôt que « erreur inconnue ».
      setStatus('idle');
      live.current.onError(
        'Le micro n’est pas accessible. Autorisez-le dans les réglages du navigateur.'
      );
      return;
    }

    mic.current = stream;

    try {
      const connection = new RTCPeerConnection();
      pc.current = connection;

      const element = document.createElement('audio');
      element.autoplay = true;
      audio.current = element;
      connection.ontrack = (event) => {
        element.srcObject = event.streams[0];
      };

      stream.getTracks().forEach((track) => connection.addTrack(track, stream));

      const events = connection.createDataChannel('oai-events');
      channel.current = events;
      events.onmessage = (message) => {
        try {
          handleEvent(JSON.parse(message.data as string));
        } catch {
          // Un message illisible se jette : il n'y a rien à en tirer, et lever
          // ici couperait la conversation entière.
        }
      };

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      const answer = await fetch(minted.sdp_url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${minted.token}`,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (!answer.ok) {
        throw new Error(`Négociation refusée (${answer.status})`);
      }

      await connection.setRemoteDescription({ type: 'answer', sdp: await answer.text() });

      setStatus('live');

      // Le micro se referme tout seul : oublier une session ouverte coûte de
      // l'argent en silence, et personne ne surveille un onglet en arrière-plan.
      timer.current = setTimeout(() => {
        live.current.onError('Session vocale close après le temps maximal. Relancez-la si besoin.');
        void stop();
      }, minted.max_seconds * 1000);
    } catch (error) {
      console.error('Connexion vocale échouée:', error);
      await stop();
      live.current.onError('La connexion vocale a échoué. Utilisez la dictée.');
    }
  }, [formId, handleEvent, projectId, status, stop, teamId]);

  // Quitter la page pendant une session laisserait le micro ouvert et la
  // consommation non déclarée.
  useEffect(() => {
    return () => {
      channel.current?.close();
      pc.current?.close();
      mic.current?.getTracks().forEach((track) => track.stop());
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { status, start, stop };
}
