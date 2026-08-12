import 'server-only';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatSubmissionPairs } from '@/lib/submission-format';
import type { Form } from '@/types';

/**
 * PDF récapitulatif des réponses, joint à l'email de confirmation du répondant.
 *
 * Helvetica plutôt qu'une police embarquée : les polices standard PDF utilisent
 * l'encodage WinAnsi, qui couvre les accents français. Embarquer une police
 * ajouterait ~300 Ko à chaque pièce jointe pour un rendu équivalent.
 */

const PAGE_WIDTH = 595.28; // A4 en points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** Navy Mooove — la seule couleur de ce document. */
const NAVY = rgb(0x05 / 255, 0x21 / 255, 0x39 / 255);
const GREY = rgb(0.42, 0.45, 0.5);

/**
 * WinAnsi ne connaît ni les guillemets typographiques ni les espaces insécables :
 * un caractère absent fait échouer `drawText`. On les remplace en amont plutôt
 * que de laisser la génération planter sur une apostrophe courbe.
 */
function toWinAnsi(input: string): string {
  return input
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/[^\x00-\xFF]/g, '?');
}

/** Découpe un texte pour qu'aucune ligne ne dépasse `maxWidth`. */
function wrap(
  text: string,
  font: import('pdf-lib').PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);

      // Un mot seul plus large que la colonne (une URL, typiquement) est coupé.
      let remainder = word;
      while (font.widthOfTextAtSize(remainder, size) > maxWidth && remainder.length > 1) {
        let cut = remainder.length;
        while (cut > 1 && font.widthOfTextAtSize(remainder.slice(0, cut), size) > maxWidth) cut--;
        lines.push(remainder.slice(0, cut));
        remainder = remainder.slice(cut);
      }
      current = remainder;
    }
    lines.push(current);
  }

  return lines;
}

/** Génère le PDF des réponses d'une soumission. */
export async function buildSubmissionPdf(params: {
  form: Form;
  responses: Record<string, unknown>;
  submittedAt: string;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(toWinAnsi(params.form.title));
  pdf.setCreator('Papyrus — Mooove');

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPageIfNeeded = (needed: number) => {
    if (y - needed >= MARGIN) return;
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  const write = (
    text: string,
    options: { size: number; font: typeof regular; color?: typeof NAVY; gap?: number }
  ) => {
    const lines = wrap(toWinAnsi(text), options.font, options.size, CONTENT_WIDTH);
    const lineHeight = options.size * 1.4;

    for (const line of lines) {
      newPageIfNeeded(lineHeight);
      page.drawText(line, {
        x: MARGIN,
        y: y - options.size,
        size: options.size,
        font: options.font,
        color: options.color ?? NAVY
      });
      y -= lineHeight;
    }
    y -= options.gap ?? 0;
  };

  write(params.form.title, { size: 20, font: bold, gap: 4 });
  write(
    `Réponse enregistrée le ${new Date(params.submittedAt).toLocaleString('fr-FR')}`,
    { size: 10, font: regular, color: GREY, gap: 18 }
  );

  const pairs = formatSubmissionPairs(params.form, params.responses);

  if (pairs.length === 0) {
    write('Aucune réponse enregistrée.', { size: 11, font: regular, color: GREY });
  }

  for (const pair of pairs) {
    newPageIfNeeded(48);
    write(pair.label, { size: 11, font: bold, gap: 2 });
    write(pair.value, { size: 11, font: regular, color: GREY, gap: 12 });
  }

  return pdf.save();
}
