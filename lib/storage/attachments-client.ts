'use client';

import { uploadMedia, UploadError, type UploadOptions } from './upload-client';

/**
 * Point d'entrée unique pour tout fichier téléversé par l'application.
 *
 * C'est ici — et uniquement ici — qu'est appliquée la règle de stockage Mooove :
 *   · images et vidéos  → Cloudflare R2 (bucket `mooove-media`, CDN public)
 *   · tout le reste     → Supabase Storage (bucket `form-documents`, RLS)
 *
 * Router les deux cas au même endroit évite que la règle se dilue au fil des
 * composants : aucun appelant ne choisit son backend de stockage.
 */

/** Bucket Supabase Storage réservé aux pièces jointes non-média. */
export const DOCUMENTS_BUCKET = 'papyrus-documents';

/** Taille maximale d'un document non-média. */
export const MAX_DOCUMENT_MB = 25;

const ALLOWED_DOCUMENT_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'rtf', 'odt', 'ods', 'zip'
];

export interface AttachmentResult {
  url: string;
  /** Backend réellement utilisé — utile pour les logs et le débogage. */
  storage: 'r2' | 'supabase';
}

function isMedia(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/');
}

function extensionOf(file: File): string {
  const parts = file.name.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

/**
 * Téléverse un fichier et renvoie son URL de lecture.
 * Les images et vidéos partent sur R2, les documents sur Supabase Storage.
 */
export async function uploadAttachment(
  file: File,
  options: UploadOptions = {}
): Promise<AttachmentResult> {
  if (isMedia(file)) {
    const url = await uploadMedia(file, options);
    return { url, storage: 'r2' };
  }

  const extension = extensionOf(file);
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(extension)) {
    throw new UploadError(
      `Type de document non autorisé (.${extension || '?'}). Formats acceptés : ${ALLOWED_DOCUMENT_EXTENSIONS.join(', ')}.`
    );
  }

  if (file.size > MAX_DOCUMENT_MB * 1024 * 1024) {
    throw new UploadError(`Document trop volumineux (max ${MAX_DOCUMENT_MB} Mo).`);
  }

  // Les documents transitent par notre API : le bucket n'accepte aucune écriture
  // directe depuis un client, ce qui empêche d'en faire un dépôt de fichiers ouvert.
  const body = new FormData();
  body.append('file', file);
  body.append('context', options.context ?? 'builder');
  if (options.formSlug) body.append('formSlug', options.formSlug);

  const response = await fetch('/api/uploads/document', {
    method: 'POST',
    body,
    signal: options.signal
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new UploadError(payload?.error ?? "Échec de l'envoi du document.");
  }

  const payload = (await response.json()) as { url: string };
  return { url: payload.url, storage: 'supabase' };
}

/** Pré-validation commune aux deux backends, pour un retour immédiat à l'utilisateur. */
export function checkAttachment(file: File): string | null {
  if (isMedia(file)) {
    const maxMb = file.type.startsWith('image/') ? 10 : 100;
    if (file.size > maxMb * 1024 * 1024) return `Fichier trop volumineux (max ${maxMb} Mo).`;
    return null;
  }

  const extension = extensionOf(file);
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(extension)) {
    return `Type de fichier non autorisé (.${extension || '?'}).`;
  }
  if (file.size > MAX_DOCUMENT_MB * 1024 * 1024) {
    return `Document trop volumineux (max ${MAX_DOCUMENT_MB} Mo).`;
  }
  return null;
}
