import 'server-only';

import writeXlsxFile from 'write-excel-file/node';

/**
 * Écriture de classeurs XLSX.
 *
 * `write-excel-file` remplace `xlsx` (SheetJS), retiré des dépendances : sa
 * dernière version publiée sur npm porte deux failles **sans correctif**
 * (pollution de prototype, et une expression régulière exponentielle), et
 * l'auteur ne publie plus que sur son propre serveur. Une dépendance qu'on ne
 * peut plus mettre à jour n'est pas une dépendance, c'est une dette.
 *
 * Côté serveur, et pas dans le navigateur : l'export doit porter sur ce que le
 * filtre désigne, pas sur ce que la page a chargé. Les deux divergent dès qu'un
 * tableau pagine.
 */

export interface SheetData {
  /** Nom de l'onglet. Excel refuse `[ ] : * ? / \` et plus de 31 caractères. */
  name: string;
  headers: string[];
  rows: (string | number)[][];
}

type Cell = { value?: string | number; fontWeight?: 'bold'; type?: typeof String | typeof Number };

/**
 * Excel impose des règles sur les noms d'onglet, et les fait respecter en
 * refusant le fichier entier. Un onglet nommé d'après une réponse libre —
 * « Formule : Table de 6 » — produirait donc un classeur illisible plutôt qu'un
 * onglet mal nommé.
 */
export function safeSheetName(raw: string, fallback = 'Réponses'): string {
  const cleaned = raw
    .replace(/[[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || fallback;
}

function toCells(headers: string[], rows: (string | number)[][]): Cell[][] {
  const head: Cell[] = headers.map((label) => ({ value: label, fontWeight: 'bold' }));

  const body = rows.map((row) =>
    row.map((value): Cell =>
      // Le type est déclaré explicitement : sans lui, un numéro de commande
      // « 0007 » ou un code postal partiraient en nombre, et Excel afficherait
      // « 7 ». Seuls les montants, produits comme nombres par `exportRow`,
      // restent numériques — c'est ce qui permet d'en faire une somme.
      typeof value === 'number'
        ? { value, type: Number }
        : { value: value ?? '', type: String }
    )
  );

  return [head, ...body];
}

/** Un classeur, un ou plusieurs onglets, rendu en mémoire. */
export async function buildWorkbook(sheets: SheetData[]): Promise<Buffer> {
  if (sheets.length === 0) {
    throw new Error('Un classeur doit contenir au moins un onglet.');
  }

  // Excel refuse aussi deux onglets de même nom : après troncature à 31
  // caractères, deux libellés voisins peuvent se confondre.
  const used = new Set<string>();
  const names = sheets.map((sheet, index) => {
    let name = safeSheetName(sheet.name, `Onglet ${index + 1}`);
    let suffix = 2;
    while (used.has(name.toLowerCase())) {
      const room = 31 - String(suffix).length - 1;
      name = `${name.slice(0, room)} ${suffix}`;
      suffix += 1;
    }
    used.add(name.toLowerCase());
    return name;
  });

  const data = sheets.map((sheet) => toCells(sheet.headers, sheet.rows));

  const buffer =
    sheets.length === 1
      ? await writeXlsxFile(data[0], { buffer: true, sheet: names[0] })
      : await writeXlsxFile(data, { buffer: true, sheets: names });

  return buffer as Buffer;
}
