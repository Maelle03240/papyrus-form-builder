import { NextResponse, type NextRequest } from 'next/server';

import { createAdminClient } from '@/lib/supabase/server';
import { issuePartnerInvite, requirePartnerAccess } from '@/lib/partners-server';
import { absoluteUrl } from '@/lib/base-url';
import { portalPath } from '@/lib/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ouvre l'accès au portail d'un partenaire et renvoie son lien d'accès.
 *
 * La route existe parce qu'elle est la seule chose du programme partenaire qui
 * ne peut pas passer par la RLS : créer un compte d'authentification demande
 * l'API d'administration, donc la clé `service_role`. Elle vérifie donc
 * elle-même que l'appelant est membre de l'espace de travail du partenaire.
 *
 * Le lien est RENVOYÉ, pas seulement envoyé par e-mail. Aucun serveur SMTP n'est
 * configuré sur cette instance : s'en remettre à l'e-mail de Supabase
 * produirait une invitation qui n'arrive jamais, et un écran qui affiche
 * « invitation envoyée » pour un message qui n'existe pas est pire que pas
 * d'invitation du tout.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const guard = await requirePartnerAccess(id);
  if ('error' in guard) return guard.error;

  const { partner } = guard;

  if (!partner.email) {
    return NextResponse.json(
      { error: 'Ajoutez une adresse e-mail à ce partenaire avant de lui ouvrir son portail.' },
      { status: 400 }
    );
  }

  const invite = await issuePartnerInvite(
    partner.email,
    absoluteUrl(request, `/p/bienvenue?portal=${encodeURIComponent(partner.portal_token)}`)
  );

  if (!invite.link) {
    // Le motif exact vient de Supabase et parle d'authentification, pas du
    // formulaire : il est journalisé, et l'écran reçoit une phrase utilisable.
    console.error('Invitation partenaire refusée:', invite.error);
    return NextResponse.json(
      { error: "L'accès au portail n'a pas pu être ouvert. Réessayez dans un instant." },
      { status: 502 }
    );
  }

  // Le compte est rattaché à la fiche : c'est ce rattachement, et lui seul, qui
  // ouvrira le portail. Sans lui, le partenaire se connecte et ne voit rien.
  //
  // `user_id` n'est écrit que si Supabase a bien nommé un compte : un renvoi de
  // lien qui ne le renseignerait pas effacerait le rattachement existant, et le
  // partenaire se connecterait sur un portail vide sans que rien ne signale
  // pourquoi.
  const { error } = await createAdminClient()
    .from('partners')
    .update({
      ...(invite.userId ? { user_id: invite.userId } : {}),
      invited_at: new Date().toISOString()
    })
    .eq('id', partner.id);

  if (error) {
    console.error('Rattachement du compte partenaire échoué:', error);
    return NextResponse.json(
      { error: "L'accès a été créé mais n'a pas pu être rattaché au partenaire." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    invite_link: invite.link,
    portal_link: absoluteUrl(request, portalPath(partner.portal_token))
  });
}
