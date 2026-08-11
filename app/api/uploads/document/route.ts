import { NextResponse, type NextRequest } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dépôt d'une pièce jointe NON-média (PDF, DOCX, XLSX…) dans Supabase Storage.
 *
 * Les images et les vidéos ne passent jamais par ici : elles vont sur
 * Cloudflare R2 via /api/uploads/presign. Cette route est le seul chemin
 * d'écriture vers le bucket `form-documents` — il n'existe aucune policy INSERT
 * qui permettrait à un client d'y écrire directement.
 */

const BUCKET = 'papyrus-documents';
const MAX_BYTES = 25 * 1024 * 1024;

/** Extensions autorisées, associées au type MIME qui sera réellement stocké. */
const ALLOWED: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip'
};

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  }

  const file = formData.get('file');
  const context = String(formData.get('context') ?? 'builder');
  const formSlug = formData.get('formSlug');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Aucun fichier reçu.' }, { status: 400 });
  }

  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Document invalide ou trop volumineux (max ${MAX_BYTES / 1024 / 1024} Mo).` },
      { status: 400 }
    );
  }

  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  const contentType = ALLOWED[extension];
  if (!contentType) {
    return NextResponse.json(
      { error: `Type de document non autorisé (.${extension || '?'}).` },
      { status: 400 }
    );
  }

  // Contrôle d'accès : créateur connecté, ou répondant sur un formulaire publié.
  let folder: string;

  if (context === 'response') {
    if (typeof formSlug !== 'string' || !formSlug) {
      return NextResponse.json({ error: 'formSlug manquant.' }, { status: 400 });
    }

    const limit = rateLimit(`doc:response:${ip}`, 10, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Trop de fichiers envoyés. Réessayez dans un instant.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    const admin = createAdminClient();
    const { data: form } = await admin
      .from('forms')
      .select('id, status, closes_at')
      .eq('slug', formSlug)
      .maybeSingle();

    if (!form || form.status !== 'published') {
      return NextResponse.json({ error: 'Formulaire non accessible.' }, { status: 403 });
    }
    if (form.closes_at && new Date(form.closes_at) < new Date()) {
      return NextResponse.json({ error: 'Ce formulaire est fermé aux réponses.' }, { status: 403 });
    }

    folder = 'responses';
  } else {
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
    }

    const limit = rateLimit(`doc:builder:${user.id}`, 40, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Trop de fichiers envoyés. Réessayez dans un instant.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    folder = 'builder';
  }

  // Le nom d'origine n'est jamais réutilisé : UUID + extension validée.
  const path = `${folder}/${crypto.randomUUID()}.${extension}`;
  const admin = createAdminClient();

  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType, upsert: false });

  if (error) {
    console.error('Échec du dépôt de document:', error.message);
    return NextResponse.json({ error: "Échec de l'enregistrement du document." }, { status: 500 });
  }

  const {
    data: { publicUrl }
  } = admin.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({ url: publicUrl, originalName: file.name });
}
