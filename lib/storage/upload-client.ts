'use client';

/**
 * Téléversement d'images et de vidéos vers Cloudflare R2 depuis le navigateur.
 *
 * Remplace l'ancien `FileReader.readAsDataURL()` : les médias ne sont plus
 * encodés en base64 dans le JSON du formulaire (ce qui gonflait la base et
 * cassait les payloads), ils vivent sur R2 et le formulaire ne stocke qu'une URL.
 *
 * Le fichier va directement du navigateur à R2 via une URL présignée — notre
 * backend ne voit jamais les octets.
 */

export interface UploadOptions {
  /** `builder` = créateur connecté · `response` = répondant sur un formulaire public. */
  context?: 'builder' | 'response';
  /** Slug du formulaire — obligatoire quand `context` vaut `response`. */
  formSlug?: string;
  /** Signal d'annulation (démontage de composant, remplacement du fichier…). */
  signal?: AbortSignal;
  /** Progression du téléversement, de 0 à 100. */
  onProgress?: (percent: number) => void;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresInSeconds: number;
}

/**
 * Téléverse un fichier et renvoie son URL publique définitive
 * (`https://media.mooove.ltd/papyrus/...`), à stocker telle quelle.
 */
export async function uploadMedia(file: File, options: UploadOptions = {}): Promise<string> {
  const { context = 'builder', formSlug, signal, onProgress } = options;

  // 1. Demander une URL présignée. Le serveur valide type et taille.
  const presignResponse = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      context,
      formSlug
    }),
    signal
  });

  if (!presignResponse.ok) {
    const body = await presignResponse.json().catch(() => null);
    throw new UploadError(body?.error ?? "Impossible de préparer l'envoi du fichier.");
  }

  const presigned = (await presignResponse.json()) as PresignResponse;

  // 2. Envoyer le fichier directement à R2 (XHR pour avoir la progression).
  await putWithProgress(presigned.uploadUrl, file, onProgress, signal);

  return presigned.publicUrl;
}

function putWithProgress(
  url: string,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      // 403 juste après signature = quasi toujours un problème de CORS sur le bucket.
      reject(
        new UploadError(
          xhr.status === 403
            ? "Envoi refusé par le stockage. Le domaine de cette application doit être ajouté à la politique CORS du bucket R2."
            : `Échec de l'envoi du fichier (HTTP ${xhr.status}).`
        )
      );
    };

    xhr.onerror = () =>
      reject(new UploadError("Échec réseau pendant l'envoi. Vérifiez votre connexion."));

    xhr.onabort = () => reject(new DOMException('Envoi annulé', 'AbortError'));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(file);
  });
}

/** Limites appliquées côté serveur — dupliquées ici pour un retour d'erreur immédiat. */
export const MAX_IMAGE_MB = 10;
export const MAX_VIDEO_MB = 100;

/**
 * Pré-vérification côté navigateur : évite un aller-retour réseau pour un fichier
 * manifestement invalide. Le serveur revalide systématiquement.
 */
export function checkMediaFile(file: File): string | null {
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');

  if (!isImage && !isVideo) {
    return 'Seules les images et les vidéos sont acceptées ici.';
  }

  const maxMb = isImage ? MAX_IMAGE_MB : MAX_VIDEO_MB;
  if (file.size > maxMb * 1024 * 1024) {
    return `Fichier trop volumineux (max ${maxMb} Mo).`;
  }

  return null;
}
