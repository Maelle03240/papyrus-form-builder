import 'server-only';

import { GoogleApiError } from './oauth';

/**
 * Le strict nécessaire des API Google Sheets et Drive : créer une feuille, lister
 * celles que Papyrus a créées, lire ses onglets, y écrire l'en-tête et y ajouter
 * une ligne par réponse.
 */

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

async function call<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string; status?: string } }
      | null;

    const detail = body?.error?.message ?? `Erreur Google (HTTP ${response.status})`;

    if (response.status === 401 || response.status === 403) {
      throw new GoogleApiError(
        `Google a refusé l'accès : ${detail}`,
        response.status,
        // Un 401 signifie un jeton invalide : il faut reconnecter le compte. Un
        // 403 est un problème de droits sur le document, que reconnecter ne
        // résoudra pas.
        response.status === 401
      );
    }
    if (response.status === 404) {
      throw new GoogleApiError(
        "La feuille de calcul est introuvable. A-t-elle été supprimée, ou l'accès a-t-il été retiré ?",
        404
      );
    }
    throw new GoogleApiError(detail, response.status);
  }

  return (await response.json()) as T;
}

export interface SpreadsheetSummary {
  id: string;
  name: string;
  url: string;
  modifiedAt?: string;
}

/**
 * Feuilles accessibles à Papyrus.
 *
 * Le scope `drive.file` ne donne accès qu'aux fichiers créés ou explicitement
 * ouverts par l'application : cette liste contient donc les feuilles créées
 * depuis Papyrus, pas l'intégralité du Drive de l'utilisateur. C'est le choix
 * délibéré qui évite de demander un scope restreint. Pour rattacher une feuille
 * existante, on colle son URL — l'écriture passe alors par le scope
 * `spreadsheets`.
 */
export async function listSpreadsheets(accessToken: string): Promise<SpreadsheetSummary[]> {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id,name,webViewLink,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '50'
  });

  const body = await call<{
    files?: { id: string; name: string; webViewLink?: string; modifiedTime?: string }[];
  }>(`${DRIVE_API}?${params.toString()}`, accessToken);

  return (body.files ?? []).map((file) => ({
    id: file.id,
    name: file.name,
    url: file.webViewLink ?? `https://docs.google.com/spreadsheets/d/${file.id}`,
    modifiedAt: file.modifiedTime
  }));
}

export interface SpreadsheetDetails {
  id: string;
  name: string;
  url: string;
  sheets: string[];
}

/** Métadonnées d'une feuille : son nom et la liste de ses onglets. */
export async function getSpreadsheet(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetDetails> {
  const body = await call<{
    spreadsheetId: string;
    properties: { title: string };
    spreadsheetUrl: string;
    sheets: { properties: { title: string } }[];
  }>(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title`,
    accessToken
  );

  return {
    id: body.spreadsheetId,
    name: body.properties.title,
    url: body.spreadsheetUrl,
    sheets: (body.sheets ?? []).map((sheet) => sheet.properties.title)
  };
}

/** Crée une feuille de calcul avec un onglet nommé. */
export async function createSpreadsheet(
  accessToken: string,
  title: string,
  sheetTitle: string
): Promise<SpreadsheetDetails> {
  const body = await call<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties: { title: string };
    sheets: { properties: { title: string } }[];
  }>(SHEETS_API, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: sheetTitle } }]
    })
  });

  return {
    id: body.spreadsheetId,
    name: body.properties.title,
    url: body.spreadsheetUrl,
    sheets: (body.sheets ?? []).map((sheet) => sheet.properties.title)
  };
}

/** Ajoute un onglet s'il n'existe pas déjà. */
export async function ensureSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<void> {
  const details = await getSpreadsheet(accessToken, spreadsheetId);
  if (details.sheets.includes(sheetTitle)) return;

  await call(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: sheetTitle } } }]
    })
  });
}

function range(sheetTitle: string, cells: string): string {
  // Un nom d'onglet peut contenir des espaces ou une apostrophe : il doit être
  // cité, et l'apostrophe doublée.
  return `'${sheetTitle.replace(/'/g, "''")}'!${cells}`;
}

/** 1 → A, 26 → Z, 27 → AA. */
function columnLetter(index: number): string {
  let n = Math.max(1, index);
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Première ligne de l'onglet, ou tableau vide si l'onglet est neuf. */
export async function readHeaderRow(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<string[]> {
  const body = await call<{ values?: string[][] }>(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      range(sheetTitle, 'A1:ZZ1')
    )}`,
    accessToken
  );
  return body.values?.[0] ?? [];
}

/**
 * Écrit la ligne d'en-tête si elle est absente ou si les questions du formulaire
 * ont changé. Écrire systématiquement l'en-tête effacerait les intitulés que
 * l'utilisateur aurait retouchés dans sa feuille.
 */
export async function syncHeaderRow(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  headers: string[]
): Promise<void> {
  const existing = await readHeaderRow(accessToken, spreadsheetId, sheetTitle);

  const identical =
    existing.length === headers.length && existing.every((value, i) => value === headers[i]);
  if (identical) return;

  // La plage doit couvrir exactement les colonnes écrites : `values.update`
  // refuse d'écrire au-delà de la plage demandée (« tried writing to column B »),
  // et une plage plus large laisserait en place les intitulés d'une version
  // précédente du formulaire qui comptait davantage de questions.
  const width = Math.max(headers.length, existing.length, 1);
  const padded = [...headers, ...Array(Math.max(0, width - headers.length)).fill('')];

  await call(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      range(sheetTitle, `A1:${columnLetter(width)}1`)
    )}?valueInputOption=RAW`,
    accessToken,
    { method: 'PUT', body: JSON.stringify({ values: [padded] }) }
  );
}

/** Ajoute des lignes à la suite des données existantes. */
export async function appendRows(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  rows: string[][]
): Promise<void> {
  if (rows.length === 0) return;

  await call(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      range(sheetTitle, 'A1')
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    accessToken,
    { method: 'POST', body: JSON.stringify({ values: rows }) }
  );
}

/** Efface toutes les lignes de données sans toucher à l'en-tête. */
export async function clearRows(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<void> {
  await call(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      range(sheetTitle, 'A2:ZZ')
    )}:clear`,
    accessToken,
    { method: 'POST', body: '{}' }
  );
}

/** Extrait l'identifiant d'une URL Google Sheets, ou renvoie l'entrée si c'est déjà un ID. */
export function parseSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];

  // Un identifiant Google fait une quarantaine de caractères sans séparateur.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;

  return null;
}
