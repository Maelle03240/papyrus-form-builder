import 'server-only';

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatAnswer, isAnswerable } from '@/lib/submission-format';
import { formatMoney } from '@/lib/pricing';
import { evaluateFormVisibility } from '@/lib/visibility';
import type { Field, Form, LogicRule, Section, TotalsSnapshot } from '@/types';

/**
 * Le document PDF d'une réponse — récapitulatif ou bon de commande.
 *
 * C'est la même page dans les deux cas, et c'est délibéré : ce qui les distingue
 * n'est pas la mise en forme mais la présence d'un numéro et de totaux. Un
 * formulaire de contact produit un récapitulatif ; le même formulaire, une fois
 * les prix posés et la numérotation activée sur son projet, produit un bon de
 * commande. Maintenir deux gabarits ferait diverger l'un des deux au premier
 * changement.
 *
 * Helvetica plutôt qu'une police embarquée : les polices standard PDF utilisent
 * l'encodage WinAnsi, qui couvre les accents français. Embarquer une police
 * ajouterait ~300 Ko à chaque pièce jointe pour un rendu équivalent.
 */

const PAGE_WIDTH = 595.28; // A4 en points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LABEL_WIDTH = CONTENT_WIDTH * 0.4;
const VALUE_WIDTH = CONTENT_WIDTH * 0.58;
const VALUE_X = MARGIN + CONTENT_WIDTH * 0.42;

/** Navy Mooove — la couleur du texte et des titres. */
const NAVY = rgb(0x05 / 255, 0x21 / 255, 0x39 / 255);
const GREY = rgb(0.42, 0.45, 0.5);
const HAIRLINE = rgb(0.9, 0.93, 0.95);

/** Délai au-delà duquel une signature n'est plus attendue. */
const SIGNATURE_TIMEOUT_MS = 5_000;

export interface SubmissionPdfParams {
  form: Form;
  responses: Record<string, unknown>;
  submittedAt: string;
  /** Numéro de bon de commande. Absent : le document reste un récapitulatif. */
  invoiceNumber?: string | null;
  /** Nom du projet, affiché sous le titre. */
  projectName?: string;
  /** Totaux figés à l'envoi. Ils ne sont jamais recalculés ici. */
  pricing?: TotalsSnapshot | null;
}

/**
 * WinAnsi ne connaît ni les guillemets typographiques ni les espaces insécables :
 * un caractère absent fait échouer `drawText`. On les remplace en amont plutôt
 * que de laisser la génération planter sur une apostrophe courbe.
 */
function toWinAnsi(input: string): string {
  return input
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    // Espaces et séparateurs, écrits en points de code plutôt qu'en clair.
    //
    // `formatMoney` produit du fr-FR, où l'espace des milliers est une ESPACE
    // FINE INSÉCABLE (U+202F). Elle sort de Latin-1, donc elle tombait dans le
    // remplacement générique de la ligne suivante : tout montant à quatre
    // chiffres s'imprimait « 3?000,00 » sur le bon de commande.
    //
    // Les écrire en clair n'est pas une option : U+2028 et U+2029 sont des
    // séparateurs de ligne, que JavaScript traite comme des retours à la ligne
    // — la classe de caractères se refermerait à la ligne suivante.
    .replace(/[\u00a0\u2007\u2009\u200a\u202f\u2028\u2029]/g, ' ')
    .replace(/[^\x00-\xFF]/g, '?');
}

/** Découpe un texte pour qu'aucune ligne ne dépasse `maxWidth`. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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

/**
 * Récupère l'image d'une signature.
 *
 * Elle vit sur R2, sous une adresse publique : le PDF va la chercher au moment
 * de sa génération. Sans cela, un bon de commande signé n'afficherait qu'une
 * URL — c'est-à-dire, sur le document qui sert de preuve, exactement rien.
 *
 * Toute défaillance est absorbée : un réseau lent ne doit pas priver le
 * répondant de son e-mail de confirmation. Le champ retombe alors sur son texte.
 */
async function fetchSignature(url: unknown): Promise<Uint8Array | null> {
  if (typeof url !== 'string' || !/^https:\/\//.test(url) || !/\.png(\?|$)/i.test(url)) {
    return null;
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(SIGNATURE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    // Une signature manuscrite pèse quelques kilo-octets ; au-delà, ce n'est pas
    // une signature, et l'incorporer gonflerait la pièce jointe pour rien.
    if (buffer.byteLength > 2_000_000) return null;
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

export async function buildSubmissionPdf(params: SubmissionPdfParams): Promise<Uint8Array> {
  const { form, responses, pricing } = params;

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(toWinAnsi(params.invoiceNumber || form.title));
  pdf.setCreator('Papyrus — Mooove');

  let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const breakPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  const ensure = (needed: number) => {
    if (y - needed < MARGIN) breakPage();
  };

  const text = (
    value: string,
    options: {
      size: number;
      font: PDFFont;
      color?: ReturnType<typeof rgb>;
      x?: number;
      width?: number;
      gap?: number;
    }
  ) => {
    const width = options.width ?? CONTENT_WIDTH;
    const lines = wrap(toWinAnsi(value), options.font, options.size, width);
    const lineHeight = options.size * 1.4;

    for (const line of lines) {
      ensure(lineHeight);
      page.drawText(line, {
        x: options.x ?? MARGIN,
        y: y - options.size,
        size: options.size,
        font: options.font,
        color: options.color ?? NAVY
      });
      y -= lineHeight;
    }
    y -= options.gap ?? 0;
  };

  // ── En-tête ───────────────────────────────────────────────────────────────
  text(form.title || 'Formulaire', { size: 20, font: bold, gap: 2 });
  // Le nom du projet n'est repris que s'il apporte quelque chose : un formulaire
  // unique porte souvent le nom de son projet, et l'écrire deux fois de suite
  // fait douter le lecteur de ce qu'il regarde.
  if (params.projectName && params.projectName.trim() !== (form.title ?? '').trim()) {
    text(params.projectName, { size: 11, font: regular, color: GREY, gap: 2 });
  }

  const submitted = new Date(params.submittedAt);
  const dateLabel = Number.isNaN(submitted.getTime())
    ? ''
    : submitted.toLocaleString('fr-FR');

  if (params.invoiceNumber) {
    text(`Bon de commande n° ${params.invoiceNumber}`, {
      size: 12,
      font: bold,
      gap: 2
    });
  }
  text(dateLabel ? `Réponse enregistrée le ${dateLabel}` : 'Réponse enregistrée', {
    size: 10,
    font: regular,
    color: GREY,
    gap: 10
  });

  ensure(12);
  page.drawRectangle({ x: MARGIN, y, width: CONTENT_WIDTH, height: 2, color: NAVY });
  y -= 20;

  // ── Réponses ──────────────────────────────────────────────────────────────
  //
  // Seules les questions réellement affichées au répondant sont imprimées.
  // `/api/submit` écarte déjà les réponses des champs devenus invisibles, mais
  // le PDF peut aussi être régénéré depuis une réponse ancienne, enregistrée
  // avant cette règle : sans ce filtre, le bon de commande porterait des
  // questions d'une branche que le client n'a jamais empruntée.
  const fields = (form.fields ?? []).filter(isAnswerable);
  const sections = (form.sections ?? []) as Section[];
  const visible = evaluateFormVisibility(
    { fields: form.fields ?? [], sections, logic_rules: (form.logic_rules ?? []) as LogicRule[] },
    responses
  );

  const groups = buildGroups(fields, sections, visible.sections);

  for (const group of groups) {
    const printable = group.fields.filter((field) => visible.fields.has(field.id));
    const rows: { field: Field; value: string }[] = [];

    for (const field of printable) {
      const value = formatAnswer(field, responses[field.id], '', responses);
      if (field.type === 'signature' || value !== '') rows.push({ field, value });
    }

    if (rows.length === 0) continue;

    if (group.title) {
      ensure(28);
      text(group.title, { size: 12, font: bold, gap: 4 });
    }

    for (const row of rows) {
      const signature =
        row.field.type === 'signature' ? await fetchSignature(responses[row.field.id]) : null;

      if (signature) {
        ensure(80);
        const label = wrap(toWinAnsi(labelOf(row.field)), regular, 10, LABEL_WIDTH);
        const top = y;
        for (const [index, line] of label.entries()) {
          page.drawText(line, {
            x: MARGIN,
            y: top - 10 - index * 14,
            size: 10,
            font: regular,
            color: GREY
          });
        }
        try {
          const image = await pdf.embedPng(signature);
          const scaled = image.scaleToFit(VALUE_WIDTH, 56);
          page.drawImage(image, {
            x: VALUE_X,
            y: top - scaled.height - 4,
            width: scaled.width,
            height: scaled.height
          });
          y = Math.min(top - Math.max(label.length * 14, scaled.height + 8), y);
        } catch {
          // Une image illisible ne doit pas interrompre le document.
          y = top - Math.max(label.length * 14, 14);
        }
        drawRule(y);
        y -= 8;
        continue;
      }

      drawPair({ label: labelOf(row.field), value: row.value || '—' });
    }

    y -= 6;
  }

  if (groups.every((group) => group.fields.every((field) => !visible.fields.has(field.id)))) {
    text('Aucune réponse enregistrée.', { size: 11, font: regular, color: GREY });
  }

  // ── Totaux ────────────────────────────────────────────────────────────────
  if (pricing) {
    drawTotals(pricing);
  }

  return pdf.save();

  /** Une ligne « question / réponse », les deux colonnes alignées sur leur haut. */
  function drawPair(options: { label: string; value: string }) {
    const labelLines = wrap(toWinAnsi(options.label), regular, 10, LABEL_WIDTH);
    const valueLines = wrap(toWinAnsi(options.value), regular, 10, VALUE_WIDTH);
    const height = Math.max(labelLines.length, valueLines.length) * 14 + 8;

    if (y - height < MARGIN) breakPage();

    const top = y;
    for (const [index, line] of labelLines.entries()) {
      page.drawText(line, {
        x: MARGIN,
        y: top - 10 - index * 14,
        size: 10,
        font: regular,
        color: GREY
      });
    }
    for (const [index, line] of valueLines.entries()) {
      page.drawText(line, {
        x: VALUE_X,
        y: top - 10 - index * 14,
        size: 10,
        font: regular,
        color: NAVY
      });
    }

    y = top - height;
    drawRule(y + 4);
  }

  function drawRule(at: number) {
    if (at < MARGIN) return;
    page.drawRectangle({ x: MARGIN, y: at, width: CONTENT_WIDTH, height: 0.6, color: HAIRLINE });
  }

  /**
   * Le bloc des totaux, repris ligne à ligne de l'instantané.
   *
   * Rien n'est recalculé ici : l'instantané porte le détail figé au moment de
   * l'envoi, et c'est précisément ce qui permet de rééditer un bon de commande
   * six mois plus tard, avec des prix modifiés entre-temps.
   */
  function drawTotals(totals: TotalsSnapshot) {
    const money = (value: number) =>
      formatMoney(value, totals.currency, totals.currency_position);

    const rows: { label: string; value: string; strong?: boolean }[] = [];

    if (totals.registration && totals.registration.units > 0) {
      rows.push({
        label: `${totals.registration.label} (${totals.registration.units} x ${money(
          totals.registration.unit_price
        )})`,
        value: money(totals.registration.amount)
      });
    }
    for (const line of totals.lines) {
      rows.push({
        label: line.quantity > 1 ? `${line.label} x ${line.quantity}` : line.label,
        value: money(line.amount)
      });
    }
    rows.push({ label: totals.subtotal_label, value: money(totals.subtotal) });
    if (totals.discount > 0) {
      rows.push({
        label: `${totals.discount_label} (${totals.discount_percent} %)`,
        value: `- ${money(totals.discount)}`
      });
    }
    if (totals.vat > 0) {
      rows.push({ label: `${totals.vat_label} (${totals.vat_rate} %)`, value: money(totals.vat) });
    }
    rows.push({ label: totals.total_label, value: money(totals.total), strong: true });

    const needed = rows.length * 16 + 32;
    if (y - needed < MARGIN) breakPage();

    y -= 16;
    const boxX = MARGIN + CONTENT_WIDTH * 0.45;
    const boxWidth = CONTENT_WIDTH * 0.55;

    for (const row of rows) {
      if (row.strong) {
        page.drawRectangle({
          x: boxX,
          y: y - 2,
          width: boxWidth,
          height: 0.8,
          color: NAVY
        });
        y -= 10;
      }
      const size = row.strong ? 12 : 10;
      const font = row.strong ? bold : regular;
      const value = toWinAnsi(row.value);
      page.drawText(toWinAnsi(row.label), {
        x: boxX,
        y: y - size,
        size,
        font,
        color: row.strong ? NAVY : GREY
      });
      page.drawText(value, {
        x: MARGIN + CONTENT_WIDTH - font.widthOfTextAtSize(value, size),
        y: y - size,
        size,
        font,
        color: NAVY
      });
      y -= size * 1.6;
    }
  }
}

function labelOf(field: Field): string {
  return field.label?.fr || field.label?.en || 'Question sans libellé';
}

/**
 * Regroupe les champs par section, dans l'ordre de lecture.
 *
 * `field_order` est relatif à sa section depuis la phase 1b : trier les champs
 * sur ce seul critère entrelacerait les sections, et le bon de commande
 * présenterait les questions dans un ordre que personne n'a jamais vu à l'écran.
 */
function buildGroups(
  fields: Field[],
  sections: Section[],
  visibleSections: Set<string>
): { title: string; fields: Field[] }[] {
  if (sections.length === 0) return [{ title: '', fields }];

  const ordered = [...sections].sort((a, b) => a.section_order - b.section_order);
  const groups = ordered
    .filter((section) => visibleSections.has(section.id))
    .map((section) => ({
      title: section.title?.fr || section.title?.en || '',
      fields: fields
        .filter((field) => field.section_id === section.id)
        .sort((a, b) => a.field_order - b.field_order)
    }));

  // Un champ sans section connue reste imprimé : le perdre serait pire que
  // l'imprimer sans titre.
  const known = new Set(ordered.map((section) => section.id));
  const orphans = fields.filter((field) => !known.has(field.section_id));
  if (orphans.length > 0) groups.push({ title: '', fields: orphans });

  return groups;
}
