import { NextResponse } from 'next/server';
import { requireTeamMembership } from '@/lib/auth/form-access';
import { isEncryptionConfigured } from '@/lib/crypto';
import { buildAuthUrl, encodeState } from '@/lib/google/oauth';
import { getGoogleOAuthConfig } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Départ du consentement Google.
 *
 * L'espace de travail et l'utilisateur voyagent dans le paramètre `state`, signé
 * en HMAC : le callback ne fait donc confiance qu'à un `state` que nous avons
 * nous-mêmes émis, moins de dix minutes plus tôt.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get('teamId');
  const formId = url.searchParams.get('formId') ?? undefined;

  if (!teamId) {
    return NextResponse.json({ error: 'Paramètre teamId manquant' }, { status: 400 });
  }

  if (!getGoogleOAuthConfig()) {
    return NextResponse.json(
      {
        error:
          "L'intégration Google n'est pas configurée sur cette instance (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)."
      },
      { status: 503 }
    );
  }

  if (!isEncryptionConfigured()) {
    return NextResponse.json(
      {
        error:
          "Le chiffrement des secrets n'est pas configuré (APP_ENCRYPTION_KEY). Contactez un administrateur."
      },
      { status: 503 }
    );
  }

  const guard = await requireTeamMembership(teamId);
  if ('error' in guard) return guard.error;

  const state = encodeState({ teamId, formId, userId: guard.userId });
  return NextResponse.redirect(buildAuthUrl(state));
}
