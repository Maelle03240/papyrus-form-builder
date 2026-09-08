import { NextResponse } from 'next/server';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Extraction du texte d'un brouillon — PDF, DOCX, TXT, Markdown.
 *
 * Elle ne construit rien. Elle rend du texte, que l'assistant reçoit comme s'il
 * avait été tapé : c'est le planificateur qui décide ensuite quels outils
 * appeler.
 *
 * C'est tout ce qui reste de l'ancienne route `/api/generate-form`, qui
 * envoyait ce même texte à un modèle en lui demandant un objet JSON complet et
 * l'importait tel quel. Elle avait une limite de 3 000 caractères et une
 * seconde voie où l'on collait à la main le JSON produit par son propre
 * ChatGPT. Les deux ont disparu : un schéma écrit par un modèle est un schéma
 * que personne n'a validé.
 */

/** Taille maximale d'un document. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Longueur maximale du texte rendu.
 *
 * 40 000 caractères, contre 3 000 auparavant : la limite d'alors venait du
 * modèle gratuit employé, pas du besoin. Un cahier des charges de dix pages
 * tient ici, et c'est justement le document qu'on veut transformer en
 * formulaire.
 */
const MAX_TEXT_LENGTH = 40_000;

export async function POST(request: Request) {
  const {
    data: { user }
  } = await createClient().auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const limit = rateLimit(`ai-document:${user.id}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop de documents d’affilée. Patientez un instant.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Requête illisible.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Aucun fichier reçu.' }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (maximum ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo).` },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  let text = '';

  try {
    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      text = await readPdf(buffer);
    } else if (
      name.endsWith('.docx') ||
      file.type ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      text = (await mammoth.extractRawText({ buffer })).value ?? '';
    } else if (
      name.endsWith('.txt') ||
      name.endsWith('.md') ||
      name.endsWith('.rtf') ||
      file.type.startsWith('text/')
    ) {
      text = buffer.toString('utf-8');
    } else {
      return NextResponse.json(
        { error: 'Format non pris en charge. Utilisez un PDF, un DOCX, un TXT ou un MD.' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Extraction de document échouée:', error);
    return NextResponse.json(
      { error: 'Le texte de ce fichier n’a pas pu être lu. Il est peut-être scanné ou protégé.' },
      { status: 422 }
    );
  }

  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  if (!cleaned) {
    return NextResponse.json(
      { error: 'Ce document ne contient aucun texte lisible. S’il est scanné, il faudrait le retaper.' },
      { status: 422 }
    );
  }

  return NextResponse.json({
    text: cleaned.slice(0, MAX_TEXT_LENGTH),
    // Dit plutôt que caché : un cahier des charges tronqué produirait un
    // formulaire incomplet, et l'auteur doit pouvoir s'en apercevoir avant de
    // le publier.
    truncated: cleaned.length > MAX_TEXT_LENGTH,
    characters: cleaned.length,
    filename: file.name
  });
}

async function readPdf(buffer: Buffer): Promise<string> {
  try {
    // pdf-parse charge son worker depuis node_modules : en build standalone il
    // faut lui donner un chemin absolu résolu à l'exécution.
    const workerPath = path.join(
      process.cwd(),
      'node_modules',
      'pdfjs-dist',
      'legacy',
      'build',
      'pdf.worker.mjs'
    );
    PDFParse.setWorker(pathToFileURL(workerPath).toString());
  } catch (error) {
    console.warn('Worker PDF local introuvable:', error);
  }

  const parsed = await new PDFParse({ data: buffer }).getText();
  return parsed.text ?? '';
}
