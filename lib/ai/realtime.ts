import 'server-only';

import type { AiRuntime } from './settings';
import { agentInstructions } from './agent';
import { toolsForOpenAI } from './tools';
import type { ToolContext } from './tools';

/**
 * La voix.
 *
 * Deux chemins, et le second n'est pas un repli de confort : c'est celui qui
 * marche partout.
 *
 * · **Temps réel (WebRTC).** Le navigateur ouvre un flux audio directement vers
 *   le fournisseur. On parle, ça répond en parlant, et les outils sont appelés
 *   pendant la conversation. La clé de l'équipe ne quitte jamais le serveur :
 *   ce dernier échange la clé contre un **jeton éphémère** qui ne vaut que pour
 *   une session et quelques secondes, et c'est ce jeton-là que le navigateur
 *   reçoit. Une clé d'API livrée au navigateur serait lisible dans l'onglet
 *   réseau par quiconque ouvre les outils de développement — et facturée à
 *   l'équipe jusqu'à ce que quelqu'un s'en aperçoive.
 *
 * · **Dictée (`gpt-transcribe`).** On enregistre, on envoie l'audio au serveur,
 *   il rend du texte, et ce texte part dans la conversation écrite habituelle.
 *   Rien de tout cela n'exige WebRTC, ni micro permanent, ni pare-feu ouvert :
 *   c'est ce qui reste quand le temps réel échoue — et il échoue, sur un réseau
 *   d'entreprise qui filtre UDP.
 *
 * Ce que le serveur ne peut PAS faire en temps réel : compter les jetons. La
 * conversation ne passe pas par lui. Le plafond est donc vérifié à l'ouverture
 * de la session, et la consommation est déclarée par le navigateur à la
 * fermeture — c'est dit tel quel à l'écran plutôt que laissé à deviner.
 */

/** Le modèle de conversation vocale. */
export const REALTIME_MODEL = 'gpt-realtime-2.1';

/** Le modèle de transcription, pour la dictée. */
export const TRANSCRIBE_MODEL = 'gpt-transcribe';

/** La voix de synthèse. */
const REALTIME_VOICE = 'marin';

/**
 * Durée maximale d'une session vocale, en secondes.
 *
 * Un micro qu'on oublie ouvert coûte de l'argent en silence — littéralement.
 * Vingt minutes suffisent largement à décrire un formulaire ; au-delà, il faut
 * rouvrir, ce qui repasse par la vérification du plafond.
 */
export const REALTIME_MAX_SECONDS = 20 * 60;

interface MintedSession {
  /** Le jeton éphémère, à ne présenter qu'au fournisseur. */
  token: string;
  /** L'URL à laquelle le navigateur négocie sa connexion WebRTC. */
  sdpUrl: string;
  model: string;
  expiresAt: number | null;
}

export type MintResult =
  | { ok: true; session: MintedSession }
  | { ok: false; reason: string };

/**
 * Échange la clé de l'équipe contre un jeton de session éphémère.
 *
 * Les instructions et la liste d'outils sont figées ici, côté serveur : un
 * navigateur qui les fournirait pourrait demander au modèle n'importe quoi —
 * y compris de se croire autorisé à supprimer sans confirmation.
 */
export async function mintRealtimeSession(
  runtime: AiRuntime,
  context: ToolContext
): Promise<MintResult> {
  const body = {
    session: {
      type: 'realtime',
      model: REALTIME_MODEL,
      instructions: `${agentInstructions(context)}\n\n${VOICE_ADDENDUM}`,
      audio: {
        output: { voice: REALTIME_VOICE },
        // La transcription de ce que dit l'utilisateur sert à l'affichage : sans
        // elle, l'écran ne garde aucune trace de ce qui a été demandé.
        input: { transcription: { model: TRANSCRIBE_MODEL } }
      },
      tools: toolsForOpenAI(),
      max_output_tokens: 4096
    }
  };

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    console.error('Ouverture de session vocale impossible:', error);
    return { ok: false, reason: 'Le service vocal est injoignable. Réessayez.' };
  }

  if (!response.ok) {
    // Le corps d'erreur du fournisseur parle d'API et de champs JSON : il part
    // au journal, et l'écran reçoit une phrase qui dit quoi faire.
    console.error('Session vocale refusée:', response.status, await safeText(response));

    if (response.status === 401) {
      return {
        ok: false,
        reason: 'La clé d’API est refusée. Vérifiez-la dans Paramètres → Assistant.'
      };
    }
    if (response.status === 404) {
      return {
        ok: false,
        reason: `Le modèle vocal ${REALTIME_MODEL} n’est pas disponible sur cette clé. Utilisez la dictée.`
      };
    }
    if (response.status === 429) {
      return { ok: false, reason: 'Le fournisseur limite la cadence. Réessayez dans un instant.' };
    }
    return { ok: false, reason: 'La session vocale n’a pas pu s’ouvrir. Utilisez la dictée.' };
  }

  const payload = (await response.json()) as {
    value?: string;
    expires_at?: number;
    client_secret?: { value?: string; expires_at?: number };
  };

  // Le fournisseur a renvoyé le jeton à deux endroits selon les versions : à la
  // racine, et sous `client_secret`. On accepte les deux plutôt que de casser
  // au premier changement de forme.
  const token = payload.value ?? payload.client_secret?.value ?? null;

  if (!token) {
    console.error('Session vocale sans jeton:', payload);
    return { ok: false, reason: 'La session vocale n’a pas pu s’ouvrir. Utilisez la dictée.' };
  }

  return {
    ok: true,
    session: {
      token,
      sdpUrl: `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(REALTIME_MODEL)}`,
      model: REALTIME_MODEL,
      expiresAt: payload.expires_at ?? payload.client_secret?.expires_at ?? null
    }
  };
}

/**
 * Ce que la voix ajoute aux instructions écrites.
 *
 * À l'oral, une réponse qui énumère vingt questions est insupportable : on ne
 * peut ni la relire ni la sauter. L'écran, lui, montre déjà le formulaire.
 */
const VOICE_ADDENDUM = [
  'Tu réponds à la voix. Trois règles de plus :',
  '· Sois bref. Une ou deux phrases. Jamais de liste énumérée à l’oral.',
  '· Ne lis pas ce que tu viens de construire : la personne le voit à l’écran. Dis ce que tu as fait, pas ce qu’il contient.',
  '· Si tu n’as pas compris un mot — un nom propre, un montant — redemande-le au lieu de deviner.'
].join('\n');

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * Transcrit un enregistrement.
 *
 * L'audio passe par le serveur, contrairement au temps réel : la clé reste donc
 * où elle est, et la consommation, elle, est mesurable.
 */
export async function transcribeAudio(
  runtime: AiRuntime,
  audio: File
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append('file', audio);
  form.append('model', TRANSCRIBE_MODEL);
  // Le formulaire est en français, et la personne dicte des libellés de
  // questions : sans cette indication, une phrase courte se fait volontiers
  // transcrire en anglais.
  form.append('language', 'fr');

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.apiKey}` },
      body: form
    });
  } catch (error) {
    console.error('Transcription injoignable:', error);
    return { ok: false, reason: 'Le service de transcription est injoignable. Réessayez.' };
  }

  if (!response.ok) {
    console.error('Transcription refusée:', response.status, await safeText(response));

    if (response.status === 401) {
      return {
        ok: false,
        reason: 'La clé d’API est refusée. Vérifiez-la dans Paramètres → Assistant.'
      };
    }
    if (response.status === 404) {
      return {
        ok: false,
        reason: `Le modèle ${TRANSCRIBE_MODEL} n’est pas disponible sur cette clé.`
      };
    }
    return { ok: false, reason: 'La dictée n’a pas pu être transcrite. Réessayez.' };
  }

  const payload = (await response.json()) as { text?: string };
  const text = (payload.text ?? '').trim();

  if (!text) {
    // Un enregistrement muet n'est pas une panne : le dire évite de chercher.
    return { ok: false, reason: 'Rien n’a été entendu. Parlez plus près du micro.' };
  }

  return { ok: true, text };
}

/** Le corps d'une réponse en erreur, sans jamais faire échouer le journal. */
async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '(corps illisible)';
  }
}
