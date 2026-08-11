import 'server-only';

import { PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getR2Config, R2_APP_PREFIX } from '@/lib/env';

/**
 * Cloudflare R2 — stockage de TOUTES les images et vidéos de l'application.
 * Directive Mooove : les médias ne passent jamais par Supabase Storage.
 *
 * Le backend ne touche jamais les octets du fichier : il signe une URL PUT
 * de courte durée (5 min) et le navigateur téléverse directement vers R2.
 */

/** Durée de validité d'une URL d'upload présignée, en secondes. */
export const PRESIGNED_URL_TTL_SECONDS = 300; // 5 minutes

/** Types MIME d'images autorisés. */
export const ALLOWED_IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml'
] as const;

/** Types MIME de vidéos autorisés. */
export const ALLOWED_VIDEO_MIME = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v'
] as const;

/** Taille maximale par catégorie de média, en octets. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 Mo
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 Mo

export type MediaKind = 'image' | 'video';

/** Extension de fichier déduite du type MIME — on ne fait jamais confiance au nom fourni. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v'
};

export interface MediaValidationResult {
  ok: boolean;
  /** Message d'erreur destiné à l'utilisateur, si `ok` est faux. */
  error?: string;
  kind?: MediaKind;
  extension?: string;
}

/**
 * Valide le type MIME et la taille côté serveur, avant d'émettre la moindre URL signée.
 * C'est le seul contrôle qui compte : le navigateur peut mentir sur tout le reste.
 */
export function validateMedia(contentType: string, sizeBytes: number): MediaValidationResult {
  const mime = contentType.toLowerCase().split(';')[0].trim();

  const isImage = (ALLOWED_IMAGE_MIME as readonly string[]).includes(mime);
  const isVideo = (ALLOWED_VIDEO_MIME as readonly string[]).includes(mime);

  if (!isImage && !isVideo) {
    return {
      ok: false,
      error: `Type de fichier non autorisé (${mime}). Images et vidéos uniquement.`
    };
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: 'Taille de fichier invalide.' };
  }

  const kind: MediaKind = isImage ? 'image' : 'video';
  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;

  if (sizeBytes > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      error: `Fichier trop volumineux (${formatBytes(sizeBytes)}). Maximum ${maxMb} Mo pour ${
        isImage ? 'une image' : 'une vidéo'
      }.`
    };
  }

  return { ok: true, kind, extension: EXTENSION_BY_MIME[mime] ?? 'bin' };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Construit une clé d'objet unique : `papyrus/{scope}/{uuid}.{ext}`.
 * L'UUID évite les collisions et empêche l'énumération du bucket.
 * Le nom d'origine n'est jamais réutilisé (risque de traversal / d'injection).
 */
export function buildObjectKey(extension: string, scope = 'media'): string {
  const safeScope = scope.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'media';
  const safeExt = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  return `${R2_APP_PREFIX}/${safeScope}/${crypto.randomUUID()}.${safeExt}`;
}

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const config = getR2Config();
  cachedClient = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
  return cachedClient;
}

/** URL publique de lecture d'un objet — servie par le CDN Cloudflare, sans signature. */
export function publicUrlForKey(key: string): string {
  return `${getR2Config().publicBaseUrl}/${key}`;
}

export interface PresignedUpload {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresInSeconds: number;
}

/**
 * Génère une URL PUT présignée. La clé secrète R2 ne quitte jamais le serveur :
 * seule cette URL, valable 5 minutes et liée à un `Content-Type` précis, est
 * transmise au navigateur.
 */
export async function createPresignedUpload(
  contentType: string,
  extension: string,
  scope = 'media'
): Promise<PresignedUpload> {
  const config = getR2Config();
  const key = buildObjectKey(extension, scope);

  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType
    }),
    { expiresIn: PRESIGNED_URL_TTL_SECONDS }
  );

  return {
    uploadUrl,
    publicUrl: `${config.publicBaseUrl}/${key}`,
    key,
    expiresInSeconds: PRESIGNED_URL_TTL_SECONDS
  };
}

/**
 * Téléverse un buffer directement depuis le serveur (import Tally, migration
 * des anciennes images base64…). Le flux navigateur, lui, passe par une URL présignée.
 */
export async function putObject(
  body: Buffer | Uint8Array,
  contentType: string,
  extension: string,
  scope = 'media'
): Promise<{ key: string; publicUrl: string }> {
  const config = getR2Config();
  const key = buildObjectKey(extension, scope);

  await getClient().send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );

  return { key, publicUrl: `${config.publicBaseUrl}/${key}` };
}

/** Supprime un objet du bucket. Utilisé quand un média est retiré d'un formulaire. */
export async function deleteObject(key: string): Promise<void> {
  const config = getR2Config();
  await getClient().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

/** Extrait la clé d'objet d'une URL publique R2, ou `null` si l'URL vient d'ailleurs. */
export function keyFromPublicUrl(url: string): string | null {
  const base = getR2Config().publicBaseUrl;
  if (!url.startsWith(`${base}/`)) return null;
  return url.slice(base.length + 1) || null;
}

/** Devine le type MIME d'une data URL `data:image/png;base64,...`. */
export function mimeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([a-z0-9.+/-]+);base64,/i.exec(dataUrl);
  return match ? match[1].toLowerCase() : null;
}
