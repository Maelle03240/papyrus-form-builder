import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { z } from 'zod';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { getResendApiKey } from '@/lib/env';
import { getBaseUrl } from '@/lib/base-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Envoie une invitation par email à rejoindre un espace de travail.
 *
 * Cette route n'exigeait aucune authentification : n'importe qui pouvait la
 * frapper pour faire partir un email depuis notre domaine, avec un nom
 * d'expéditeur et un nom d'espace de son choix injectés tels quels dans le HTML.
 * C'était à la fois un relais de spam ouvert et une injection HTML.
 *
 * Désormais : session obligatoire, rôle admin sur l'espace visé, rate limit, et
 * échappement de toute valeur interpolée dans le message.
 */

const BodySchema = z.object({
  email: z.string().email().max(254)
});

/** Échappe les caractères qui auraient un sens en HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const apiKey = getResendApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'Service email non configuré' }, { status: 503 });
  }

  // 1. Session obligatoire.
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  // 2. Rate limit par utilisateur — une invitation reste un envoi d'email.
  const limit = rateLimit(`invite:${user.id}`, 10, 60 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Limite d'invitations atteinte pour cette heure." },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  // 3. Validation du corps.
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Adresse email invalide' }, { status: 400 });
  }

  const workspaceId = params.id;
  const admin = createAdminClient();

  // 4. L'appelant doit être administrateur de CET espace.
  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Droits insuffisants' }, { status: 403 });
  }

  // 5. Le nom de l'espace vient de la base, pas du client : il ne peut plus
  //    servir à injecter du contenu arbitraire dans l'email.
  const { data: team } = await admin
    .from('teams')
    .select('name')
    .eq('id', workspaceId)
    .maybeSingle();

  if (!team) {
    return NextResponse.json({ error: 'Espace de travail introuvable' }, { status: 404 });
  }

  const { data: inviterProfile } = await admin
    .from('profiles')
    .select('first_name, last_name, email')
    .eq('id', user.id)
    .maybeSingle();

  const inviterName =
    [inviterProfile?.first_name, inviterProfile?.last_name].filter(Boolean).join(' ').trim() ||
    inviterProfile?.email ||
    user.email ||
    'Un collaborateur';

  const baseUrl = getBaseUrl(request);
  const workspaceUrl = `${baseUrl}/workspaces/${workspaceId}`;

  const safeWorkspaceName = escapeHtml(team.name);
  const safeInviter = escapeHtml(inviterName);
  const safeUrl = escapeHtml(workspaceUrl);

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: 'Papyrus <noreply@mooove.live>',
      to: [parsed.data.email],
      subject: `Invitation à rejoindre « ${team.name} » sur Papyrus`,
      html: buildInviteHtml({ safeInviter, safeWorkspaceName, safeUrl }),
      text: [
        `${inviterName} vous invite à rejoindre l'espace de travail « ${team.name} » sur Papyrus.`,
        '',
        `Pour y accéder : ${workspaceUrl}`,
        '',
        'Papyrus — le form builder de Mooove.'
      ].join('\n')
    });

    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json({ error: "Erreur lors de l'envoi de l'email" }, { status: 502 });
    }

    return NextResponse.json({ success: true, id: data?.id });
  } catch (error) {
    console.error('Error in invite API:', error);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }
}

function buildInviteHtml({
  safeInviter,
  safeWorkspaceName,
  safeUrl
}: {
  safeInviter: string;
  safeWorkspaceName: string;
  safeUrl: string;
}): string {
  // Palette Mooove : Navy en fond, Cyan pour l'appel à l'action.
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Invitation Papyrus</title></head>
<body style="margin:0;padding:24px;background:#EFF9FE;font-family:'DM Sans',system-ui,-apple-system,sans-serif;line-height:1.6;color:#052139;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#052139;border-radius:20px;padding:32px;margin-bottom:20px;">
      <p style="margin:0 0 8px;color:#2AC2DE;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;">Papyrus</p>
      <h1 style="margin:0;color:#FFFFFF;font-size:26px;font-weight:700;letter-spacing:-.02em;">
        Vous êtes invité·e à rejoindre un espace de travail
      </h1>
    </div>

    <div style="background:#FFFFFF;border:1px solid #C7EAFB;border-radius:20px;padding:28px;">
      <p style="margin:0 0 16px;font-size:16px;">Bonjour,</p>
      <p style="margin:0 0 24px;font-size:16px;">
        <strong>${safeInviter}</strong> vous invite à rejoindre l'espace de travail
        <strong>« ${safeWorkspaceName} »</strong> sur Papyrus.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${safeUrl}" style="background:#2AC2DE;color:#052139;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">
          Accéder à l'espace de travail
        </a>
      </div>
      <p style="margin:0;font-size:13px;color:#4A6B82;">
        Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
        <a href="${safeUrl}" style="color:#3C5EAB;word-break:break-all;">${safeUrl}</a>
      </p>
    </div>

    <p style="margin:20px 0 0;text-align:center;font-size:12px;color:#4A6B82;">
      Papyrus — le form builder de Mooove.
    </p>
  </div>
</body>
</html>`;
}
