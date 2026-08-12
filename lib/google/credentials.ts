import 'server-only';

import { createAdminClient } from '@/lib/supabase/server';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { GoogleApiError, refreshAccessToken, revokeToken } from './oauth';

/**
 * Accès au refresh token Google d'un espace de travail.
 *
 * La table `google_credentials` n'a aucune policy RLS : elle n'est atteignable
 * qu'avec service_role, donc uniquement par le serveur. Toute route qui passe
 * par ici doit avoir vérifié elle-même les droits de l'appelant au préalable.
 */

export interface GoogleConnection {
  connected: boolean;
  email?: string | null;
  updatedAt?: string | null;
  /** Le jeton est illisible ou révoqué : l'espace doit refaire le consentement. */
  needsReconnect?: boolean;
}

export async function getGoogleConnection(teamId: string): Promise<GoogleConnection> {
  const { data } = await createAdminClient()
    .from('google_credentials')
    .select('encrypted_refresh_token, google_email, updated_at')
    .eq('team_id', teamId)
    .maybeSingle();

  if (!data) return { connected: false };

  try {
    decryptSecret(data.encrypted_refresh_token);
  } catch {
    // APP_ENCRYPTION_KEY a changé depuis l'enregistrement.
    return { connected: true, email: data.google_email, needsReconnect: true };
  }

  return {
    connected: true,
    email: data.google_email,
    updatedAt: data.updated_at,
    needsReconnect: false
  };
}

export async function saveGoogleCredentials(params: {
  teamId: string;
  refreshToken: string;
  email: string | null;
  scopes: string;
  userId: string;
}): Promise<void> {
  const { error } = await createAdminClient().from('google_credentials').upsert(
    {
      team_id: params.teamId,
      encrypted_refresh_token: encryptSecret(params.refreshToken),
      google_email: params.email,
      scopes: params.scopes,
      created_by: params.userId,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'team_id' }
  );

  if (error) throw error;
}

export async function deleteGoogleCredentials(teamId: string): Promise<void> {
  const admin = createAdminClient();

  const { data } = await admin
    .from('google_credentials')
    .select('encrypted_refresh_token')
    .eq('team_id', teamId)
    .maybeSingle();

  if (data) {
    try {
      await revokeToken(decryptSecret(data.encrypted_refresh_token));
    } catch {
      // Jeton illisible : il n'y a rien à révoquer côté Google.
    }
  }

  await admin.from('google_credentials').delete().eq('team_id', teamId);
}

/**
 * Jeton d'accès frais pour un espace de travail.
 * Lève une `GoogleApiError` explicite si l'espace n'est pas connecté — le message
 * remonte tel quel jusqu'à l'interface, sans exposer d'erreur Postgres.
 */
export async function getAccessTokenForTeam(teamId: string): Promise<string> {
  const { data } = await createAdminClient()
    .from('google_credentials')
    .select('encrypted_refresh_token')
    .eq('team_id', teamId)
    .maybeSingle();

  if (!data) {
    throw new GoogleApiError("Aucun compte Google n'est connecté à cet espace de travail.", 401, true);
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(data.encrypted_refresh_token);
  } catch {
    throw new GoogleApiError(
      'Le jeton Google enregistré est illisible. Reconnectez le compte.',
      500,
      true
    );
  }

  return refreshAccessToken(refreshToken);
}
