import 'server-only';

import type {
  TallyFormDetail,
  TallyFormSummary,
  TallySubmissionsPage
} from './types';

/**
 * Client de l'API Tally.
 *
 * Toutes les requêtes partent du serveur : la clé API d'un client ne doit jamais
 * transiter par le navigateur.
 */

const TALLY_API = 'https://api.tally.so';
const REQUEST_TIMEOUT_MS = 20_000;

export class TallyApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'TallyApiError';
  }
}

async function tallyFetch<T>(apiKey: string, path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${TALLY_API}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
      },
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new TallyApiError(messageForStatus(response.status), response.status);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof TallyApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new TallyApiError('Tally ne répond pas (délai dépassé).', 504);
    }
    throw new TallyApiError('Impossible de joindre Tally.', 502);
  } finally {
    clearTimeout(timeout);
  }
}

function messageForStatus(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return 'Clé API Tally refusée. Vérifiez-la dans Tally › Settings › API.';
    case 404:
      return 'Formulaire Tally introuvable avec cette clé API.';
    case 429:
      return 'Tally limite temporairement les requêtes. Réessayez dans une minute.';
    default:
      return `Tally a renvoyé une erreur (HTTP ${status}).`;
  }
}

/** Vérifie qu'une clé API fonctionne, en listant les formulaires accessibles. */
export async function listForms(apiKey: string): Promise<TallyFormSummary[]> {
  const payload = await tallyFetch<{ items?: TallyFormSummary[] } | TallyFormSummary[]>(
    apiKey,
    '/forms'
  );
  return Array.isArray(payload) ? payload : (payload.items ?? []);
}

/** Structure complète d'un formulaire (ses blocs). */
export async function getForm(apiKey: string, formId: string): Promise<TallyFormDetail> {
  return tallyFetch<TallyFormDetail>(apiKey, `/forms/${encodeURIComponent(formId)}`);
}

/**
 * Toutes les réponses d'un formulaire, page par page.
 *
 * `maxResponses` borne l'import : sans limite, un formulaire à 100 000 réponses
 * ferait tomber la requête en timeout et gonflerait la base d'un coup.
 */
export async function getAllSubmissions(
  apiKey: string,
  formId: string,
  maxResponses = 5000
): Promise<{ pages: TallySubmissionsPage[]; truncated: boolean }> {
  const pages: TallySubmissionsPage[] = [];
  let page = 1;
  let collected = 0;

  // Garde-fou : au pire 50 pages, même si Tally renvoie toujours `hasMore`.
  while (page <= 50) {
    const result = await tallyFetch<TallySubmissionsPage>(
      apiKey,
      `/forms/${encodeURIComponent(formId)}/submissions?page=${page}&limit=100`
    );

    pages.push(result);
    collected += result.submissions?.length ?? 0;

    if (!result.hasMore || (result.submissions?.length ?? 0) === 0) {
      return { pages, truncated: false };
    }

    if (collected >= maxResponses) {
      return { pages, truncated: true };
    }

    page += 1;
  }

  return { pages, truncated: true };
}

/**
 * Extrait l'identifiant d'un formulaire depuis une URL Tally publique
 * (`https://tally.so/r/wA5bEq`) ou d'admin (`https://tally.so/forms/wA5bEq/edit`).
 * Accepte aussi un identifiant brut.
 */
export function parseFormId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Identifiant brut : alphanumérique court, sans séparateur d'URL.
  if (/^[A-Za-z0-9_-]{4,32}$/.test(trimmed) && !trimmed.includes('.')) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (!/(^|\.)tally\.so$/i.test(url.hostname)) return null;

    const segments = url.pathname.split('/').filter(Boolean);

    // /r/{id} · /forms/{id} · /forms/{id}/edit
    const index = segments.findIndex((segment) => segment === 'r' || segment === 'forms');
    if (index >= 0 && segments[index + 1]) return segments[index + 1];

    return segments[0] ?? null;
  } catch {
    return null;
  }
}
