import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Chiffrement symétrique des secrets tiers stockés en base (aujourd'hui : la clé
 * API Tally d'une équipe).
 *
 * Objectif : un accès en lecture à la base — dump, sauvegarde égarée, requête
 * lancée depuis Supabase Studio — ne doit pas suffire à récupérer la clé d'un
 * client. Le déchiffrement exige `APP_ENCRYPTION_KEY`, qui ne vit que dans
 * l'environnement Easypanel.
 *
 * AES-256-GCM : chiffre et authentifie, donc un texte chiffré modifié est rejeté
 * au lieu d'être déchiffré en silence.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, taille recommandée pour GCM
const SALT = 'papyrus.secrets.v1';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const secret = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      'APP_ENCRYPTION_KEY manquante ou trop courte (32 caractères minimum). ' +
        'Générez-la avec `openssl rand -base64 32` et ajoutez-la aux variables Easypanel.'
    );
  }

  cachedKey = scryptSync(secret, SALT, 32);
  return cachedKey;
}

/** Chiffre une valeur. Format de sortie : `iv:authTag:données`, en base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url')
  ].join(':');
}

/** Déchiffre une valeur produite par `encryptSecret`. Lève si elle a été altérée. */
export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Secret chiffré illisible.');
  }

  const [ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

/** Masque un secret pour l'affichage : `tly_…a3f9`. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/** Vérifie que le chiffrement est utilisable, sans exposer la clé. */
export function isEncryptionConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
